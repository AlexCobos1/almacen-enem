const express = require("express");
const app = express();

const { spawn } = require("child_process");
const path = require("path");

// ✅ CONFIG
const TOKEN = "ENEM_SECURE_2026";
const PS_SCRIPT = path.join(__dirname, "run-macro.ps1");

// ✅ CORS simple (local)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  next();
});

app.use(express.json());
app.use(express.static(__dirname));

// ✅ ESTADO GLOBAL (clave para macro larga)
let jobStatus = {
  running: false,
  lastRun: null,
  result: null,
  error: null,
  output: null
};


// ✅ ENDPOINT EJECUCIÓN (NO BLOQUEANTE)
app.post("/api/run-macro", (req, res) => {

  const clientToken = req.headers["x-enem-token"];

  if (clientToken !== TOKEN) {
    return res.status(401).json({ success: false, error: "No autorizado" });
  }

  if (jobStatus.running) {
    return res.status(429).json({ success: false, error: "Macro en ejecución" });
  }

  jobStatus.running = true;
  jobStatus.lastRun = new Date();
  jobStatus.result = null;
  jobStatus.error = null;
  jobStatus.output = null;

  console.log(`🚀 Macro iniciada: ${new Date().toISOString()}`);

 let output = "";
let errorOutput = "";

const ps = spawn("powershell.exe", [
  "-ExecutionPolicy", "Bypass",
  "-File", PS_SCRIPT
]);

console.log("🚀 Ejecutando PowerShell:", PS_SCRIPT);

ps.stdout.on("data", (data) => {
  const txt = data.toString();
  console.log("🟢 PS OUTPUT:", txt);
  output += txt;
});

ps.stderr.on("data", (data) => {
  const txt = data.toString();
  console.error("🔴 PS ERROR:", txt);
  errorOutput += txt;
});

ps.on("error", (err) => {
  console.error("❌ FALLÓ AL LANZAR POWERSHELL:", err);
});


  ps.on("close", (code) => {

    jobStatus.running = false;
    jobStatus.output = output;

    console.log(`✅ Macro finalizó con código ${code}`);

    if (output.includes("ERROR")) {
  jobStatus.result = null;
  jobStatus.error = output;
} else if (code === 0) {
  jobStatus.result = "OK";
} else {
  jobStatus.error = errorOutput || "Error ejecutando la macro";
}


  });

  // ✅ RESPUESTA INMEDIATA (CLAVE)
  res.json({
    success: true,
    message: "Macro en ejecución"
  });

});


// ✅ ENDPOINT ESTADO
app.get("/api/macro-status", (req, res) => {

  // ✅ SI LA MACRO ESTÁ CORRIENDO Y EXISTE EL FLAG → TERMINÓ DE VERDAD
  if (jobStatus.running && fs.existsSync(FLAG_FILE)) {

    console.log("✅ Macro finalizada detectada por FLAG_FILE");

    jobStatus.running = false;
    jobStatus.result = "OK";
  }

  return res.json(jobStatus);
});



// ✅ CARGAR INDEX.HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});



app.listen(3000, "127.0.0.1", () => {
  console.log("✅ API ENEM segura en localhost:3000");
});

// ✅ ENDPOINT PARA DESCARGAR EXCEL AUTOMÁTICO
const fs = require("fs");
const FLAG_FILE = "C:\\Users\\digerienem\\OneDrive - CETCO S.A\\Archivos digerienem 2025\\Escritorio\\SAP_EXPORTS\\macro_done.txt";

app.get("/api/get-excel", async (req, res) => {

  const filePath = "C:\\Users\\digerienem\\OneDrive - CETCO S.A\\Archivos digerienem 2025\\Escritorio\\LX_APP.xlsx";

  try {

    // 🔥 Esperar hasta que el archivo exista y tenga tamaño
    let intentos = 0;
    const maxIntentos = 10;

    while (intentos < maxIntentos) {

      if (fs.existsSync(filePath)) {

        const stats = fs.statSync(filePath);

        // ✅ Validar que el archivo ya tenga contenido real
        if (stats.size > 5000) {
          console.log("✅ Archivo listo para enviar");
          break;
        }
      }

      console.log(`⏳ Esperando archivo... intento ${intentos + 1}`);
      await new Promise(r => setTimeout(r, 1000)); // espera 1 segundo
      intentos++;
    }

    // ✅ Enviar archivo
    res.download(filePath, "LX_APP.xlsx", (err) => {
      if (err) {
        console.error("❌ Error enviando archivo:", err);
        res.status(500).send("Error al descargar archivo");
      }
    });

  } catch (err) {

    console.error("❌ Error interno:", err);
    res.status(500).send("Error interno");

  }

});

