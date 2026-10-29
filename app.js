/**************************************************
 * APP ENEM - Lógica principal 
 * - Semana ISO 8601 para mayor precisión.
 * - Persistencia: corte, vista, scroll, local y Firebase Realtime.
 **************************************************/

/********** 1) Configuración y persistencia (Local + Firebase) **********/
const CLAVE_SECRETA = "ERI*";
const UI_STATE_KEY  = "uiState";
const STOCK_KEY     = "stockData";
const BLOQUEO_KEY   = "uiLocked";
let isSafeReload = false;
const MODEL_KEY     = "modelData_v2"; // modelo robusto (Sets por código)

// Conexión a tu proyecto Firebase AlmacenEnem
const firebaseConfig = {
  databaseURL: "https://almacenenem-df9f2-default-rtdb.firebaseio.com",
  projectId: "almacenenem-df9f2"
};

let db = null;
try {
  if (typeof firebase !== "undefined") {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.database();
  }
} catch (err) {
  console.error("Error inicializando Firebase:", err);
}

/** Serializa Maps/Sets a JSON seguro para localStorage y Firebase */
function saveModelToStorage() {
  try {
    const unicosArr = Array.from(__unicosPorClave?.entries?.() || [])
      .map(([k, set]) => [k, Array.from(set)]);

    const attrsArr = Array.from(codeAttrs?.entries?.() || []).map(([cod, obj]) => ([
      cod,
      {
        ubicNumMax: obj?.ubicNumMax || 0,
        uaNumMax  : obj?.uaNumMax   || 0,
        icFinal   : obj?.icFinal    || "",
        ubicSet   : Array.from(obj?.ubicSet || []),
        uaSet     : Array.from(obj?.uaSet   || []),
      }
    ]));

    const payloadStr = JSON.stringify({ unicosArr, attrsArr });
    
    // 1. Guarda en tu computador igual que siempre
    localStorage.setItem(MODEL_KEY, payloadStr);

    // 2. Envía copia automática a Firebase para actualizar todos los dispositivos
    if (db) {
      db.ref("enem_data").set({
        model: payloadStr,
        stock: JSON.stringify(stock),
        updatedAt: new Date().toISOString()
      }).catch(e => console.error("[Firebase] Error al guardar:", e));
    }
  } catch (e) {
    console.error("[Persistencia] No se pudo guardar el modelo:", e);
  }
}

/** Restaura Maps/Sets desde localStorage; devuelve true si hubo data */
function restoreModelFromStorage() {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (!raw) return false;
    const { unicosArr, attrsArr } = JSON.parse(raw);

    __unicosPorClave = new Map(
      (unicosArr || []).map(([k, list]) => [k, new Set(list || [])])
    );

    codeAttrs = new Map(
      (attrsArr || []).map(([cod, obj]) => ([
        cod,
        {
          ubicNumMax: obj?.ubicNumMax || 0,
          uaNumMax  : obj?.uaNumMax   || 0,
          icFinal   : obj?.icFinal    || "",
          ubicSet   : new Set(obj?.ubicSet || []),
          uaSet     : new Set(obj?.uaSet   || []),
        }
      ]))
    );

    return true;
  } catch (e) {
    console.error("[Persistencia] No se pudo restaurar el modelo:", e);
    return false;
  }
}

// Persistencia de "stock" (compatibilidad con vista Códigos)
const stock = {};
const guardado = localStorage.getItem(STOCK_KEY);
if (guardado) {
  try { Object.assign(stock, JSON.parse(guardado)); } catch {}
}
function guardar() { localStorage.setItem(STOCK_KEY, JSON.stringify(stock)); }

/** Listener en tiempo real (.on('value')) para actualizar cualquier pantalla al instante */
function iniciarListenerFirebase() {
  if (!db) return;
  db.ref("enem_data").on("value", (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    if (!data || !data.model) return;

    const localActual = localStorage.getItem(MODEL_KEY);
    // Si la nube trae datos nuevos o este dispositivo está vacío, actualiza al instante
    if (data.model !== localActual || __unicosPorClave.size === 0) {
      localStorage.setItem(MODEL_KEY, data.model);
      if (data.stock) {
        localStorage.setItem(STOCK_KEY, data.stock);
        try {
          for (let m in stock) delete stock[m];
          Object.assign(stock, JSON.parse(data.stock));
        } catch {}
      }
      restoreModelFromStorage();
      renderTabla();
      iluminarSemana();
      updateVistaTitulo();
      applyViewClass();
      if (currentMetric === "indicadores") {
        setView("indicadores", true);
      }
      console.log("🔥 Datos sincronizados en tiempo real desde Firebase");
    }
  });
}

/********** 2) Utilidades **********/
/** Escape seguro para inyecciones (no usar cuando se retorna HTML controlado) */
function esc(s) {
  return String(s)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

/** Cortes por semanas */
const cortes = {
  CORTE_1: { inicio:  3, fin: 13 },
  CORTE_2: { inicio: 14, fin: 26 },
  CORTE_3: { inicio: 27, fin: 39 },
  CORTE_4: { inicio: 40, fin: 52 }
};

const ORDERED_TYPES = ["BULK", "CONC", "ENEM", "MADE", "MPCL", "SUIN"];
function typeOrderIndex(t) {
  const i = ORDERED_TYPES.indexOf(t);
  return i === -1 ? ORDERED_TYPES.length + 999 : i;
}
function compareTypes(a,b){
  const ia = typeOrderIndex(a), ib = typeOrderIndex(b);
  if (ia !== ib) return ia - ib;
  if (ia >= ORDERED_TYPES.length) return a.localeCompare(b);
  return 0;
}
function norm(s){
  return (s||"").toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g,"").replace(/[^\w]/g,"").toLowerCase();
}
function findHeader(headers, aliases){
  const n = headers.map(h=>norm(h));
  for (const a of aliases.map(norm)){
    const i = n.indexOf(a);
    if (i !== -1) return headers[i];
  }
  return null;
}
function parseSemanaCell(value){
  const raw=(value??"").toString().trim(); if(!raw) return null;
  const n=norm(raw);
  if(["nuevos","nuevo","nueva","nuevas"].includes(n)) return {tipo:"nuevos"};
  const m=raw.match(/\d+/);
  if(m){ const sem=parseInt(m[0],10); if(sem>=1 && sem<=52) return {tipo:"num", semana:sem}; }
  return null;
}
function normalizeTipo(t){
  let x=(t||"").toString().trim().toUpperCase();
  x=x.replace(/[.\-]/g," ").replace(/\s+/g," ").trim();
  const map={
    "BULK":"BULK","CONC":"CONC","CONCENTRADO":"CONC","ENEM":"ENEM",
    "MADE":"MADE","M ADE":"MADE","MPCL":"MPCL","SUIN":"SUIN","SU INSUMOS":"SUIN"
  };
  return map[x] || x;
}
function tieneExistencia(stockValue){
  const s=(stockValue??"").toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  if(!s) return false;
  if(s.includes("sin existencia") || s.startsWith("sin ")) return false;
  const positivos=["existencia","en existencia","con existencia","disponible","disponibles","hay","si","sí","stock"];
  return positivos.some(p=>s.includes(p));
}

/** Divide listas múltiples en una celda y deduplica */
function splitMulti(text){
  const raw = (text ?? "").toString().trim();
  if (!raw) return [];
  let parts = raw.split(/[\n\r,;|/\\]+/g).map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    if (/\s{2,}/.test(raw)) {
      parts = raw.split(/\s{2,}/g).map(s => s.trim()).filter(Boolean);
    } else {
      const looksCompactList = /^([A-Za-z0-9_\-]+(\s+[A-Za-z0-9_\-]+)+)$/.test(raw);
      if (looksCompactList) parts = raw.split(/\s+/g).map(s => s.trim()).filter(Boolean);
    }
  }
  return Array.from(new Set(parts));
}
function isPureIntegerCell(v){
  return typeof v === "number" || (/^\s*\d+\s*$/.test((v??"").toString()));
}
function asInt(v){
  if (typeof v === "number") return Math.max(0, Math.floor(v));
  const m = (v??"").toString().match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}


/** Semana ISO 8601 (correcta para Colombia zona horaria) */
function getISOWeek(date = new Date()) {
  const d = new Date(date);
  
  // evitar problemas de zona horaria
  d.setHours(12,0,0,0);

  // jueves de la semana actual
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));

  const yearStart = new Date(d.getFullYear(), 0, 1);

  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/********** 3) DOM **********/
const verCorte      = document.getElementById("verCorte");
const infoSemana    = document.getElementById("infoSemana");
const xlsxInput     = document.getElementById("xlsxFile");
const btnImportXlsx = document.getElementById("btnImportXlsx");
const btnEmail      = document.getElementById("btnEmail");
const btnCodigos     = document.getElementById("btnCodigos");
const btnUbicaciones = document.getElementById("btnUbicaciones");
const btnUAs         = document.getElementById("btnUAs");
const btnIndicadores = document.getElementById("btnIndicadores");
const panelResumen   = document.getElementById("panelResumen");
const btnLogin       = document.getElementById("btnLogin");
const claveInput     = document.getElementById("clave");
const vistaTitulo    = document.getElementById("vistaTitulo");

/********** 4) Selector de corte **********/
verCorte.innerHTML = '<option value="TODOS">TODOS</option>';
for (let c in cortes) {
  verCorte.innerHTML += `<option value="${c}">${c}</option>`;
}

/********** 5) Info hoy (semana / corte) **********/
(function pintarSemanaActual(){
  const hoy = new Date();
  const semanaISO = getISOWeek(hoy); // cálculo preciso
  let corte = "Fuera de cortes";
  for (const [k, v] of Object.entries(cortes)) {
    if (semanaISO >= v.inicio && semanaISO <= v.fin) { corte = k; break; }
  }
     infoSemana.innerHTML = `Hoy ${hoy.toLocaleDateString()} · <span class="semana-explosiva">SEMANA ACTUAL # ${semanaISO}</span> · ${corte}`;
})();

/********** 6) Bloqueo de UI **********/
let bloqueado = true;
const savedLock = localStorage.getItem(BLOQUEO_KEY);
if (savedLock === "0") bloqueado = false;

function setDisabled(el, val){ if(el) el.disabled = val; }
function actualizarBloqueo(){
  [verCorte,xlsxInput,btnImportXlsx,btnEmail,btnCodigos,btnUbicaciones,btnUAs,btnIndicadores]
    .forEach(el => setDisabled(el, bloqueado));
  btnLogin.textContent = bloqueado ? "🔒 Bloqueado" : "🔓 Desbloqueado";
  btnLogin.setAttribute("aria-pressed", (!bloqueado).toString());
  localStorage.setItem(BLOQUEO_KEY, bloqueado ? "1" : "0");
}
btnLogin.onclick = () => {
  if (bloqueado && claveInput.value === CLAVE_SECRETA){
    bloqueado=false; claveInput.value="";
  } else if (!bloqueado) {
    bloqueado=true;
  } else {
    alert("Clave incorrecta");
  }
  actualizarBloqueo();
};
actualizarBloqueo();

/********** 7) Estado UI **********/
let currentMetric = "codigos";

/********** ROTACIÓN AUTOMÁTICA DE VISTAS **********/

const ROTATION_METRICS = ["codigos","ubicaciones","uas","indicadores"];
const ROTATION_INTERVAL = 20000; // 20 segundos

let rotationIndex = 0;
let rotationTimer = null;
// Guardar estado UI
function guardarUI(){
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({
        corte: verCorte.value,
        metric: currentMetric,
        scroll: window.scrollY
    }));
}

// Aplicar clase de vista (indicadores TV)
function applyViewClass(){
    document.body.classList.toggle("view-indicadores", currentMetric === "indicadores");
}

// Restaurar UI
function restaurarUI() {
    const saved = localStorage.getItem(UI_STATE_KEY);
    if (!saved) {
        renderTabla(); 
        iluminarSemana(); 
        updateVistaTitulo(); 
        applyViewClass(); 
        return;
    }
    try {
        const ui = JSON.parse(saved);
        if (ui.corte) verCorte.value = ui.corte;
        if (ui.metric) currentMetric = ui.metric;
        renderTabla(); 
        iluminarSemana(); // columna dinámica
        updateVistaTitulo(); 
        applyViewClass();
        setTimeout(() => window.scrollTo(0, ui.scroll || 0), 50);
    } catch {
        renderTabla(); 
        iluminarSemana(); 
        updateVistaTitulo(); 
        applyViewClass();
    }
}function iniciarRotacionAutomatica(){

  if(rotationTimer) clearInterval(rotationTimer);

  rotationIndex = ROTATION_METRICS.indexOf(currentMetric);
  if(rotationIndex === -1) rotationIndex = 0;

  rotationTimer = setInterval(() => {

    rotationIndex++;

    if(rotationIndex >= ROTATION_METRICS.length){
      rotationIndex = 0;
    }

    const nextMetric = ROTATION_METRICS[rotationIndex];

    // cambiar vista
    setView(nextMetric, false);

  }, ROTATION_INTERVAL);
}

// Listener cambio de corte
verCorte.addEventListener("change", () => {
    guardarUI(); 
    renderTabla(); 
    iluminarSemana(); 
    panelResumen.innerHTML = ""; 
});

function iluminarSemana() {
  const tablaWrap = document.getElementById("tabla");
  if (!tablaWrap) return;

  const tabla    = tablaWrap.querySelector("table");
  const theadRow = tabla?.tHead?.rows?.[0] || tabla?.querySelector("thead tr");
  const tbody    = tabla?.tBodies?.[0]     || tabla?.querySelector("tbody");
  if (!tabla || !theadRow || !tbody) return;

  // --- LIMPIEZA GLOBAL: garantiza exclusividad (no quedan restos) ---
  tabla.querySelectorAll("td, th").forEach(cell => {
    cell.classList.remove(
      "th-actual", "th-retraso", "th-adelanto",
      "col-semana-actual", "col-semana-contada", "columna-semana-activa",
      "columna-luz", "celda-principal", "th-celda-principal"
    );
    cell.removeAttribute("data-estado");
    try { cell.style.animation = ""; } catch {}
  });
  theadRow.querySelectorAll(".estado-badge").forEach(el => el.remove());
  delete document.body.dataset.estado;

  // --- Semana ISO actual (1..52) ---
  const semanaActual = getISOWeek(new Date());

  // --- Mapear SEMANAS visibles del THEAD (saltamos "Material", "NUEVOS", "Total") ---
  // Soporta: S11 | S 11 | SEM11 | SEM-11 | SEM 11 | SEMANA 11 | WK 11 | W 11
  const semanasVisibles = [];   // [{ num, index, th }]
  for (let i = 1; i < theadRow.children.length; i++) {
    const th  = theadRow.children[i];
    const raw = (th.innerText || th.textContent || "").trim().toUpperCase();

    if (raw === "NUEVOS" || raw === "TOTAL") continue;

    const m =
      raw.match(/^S\s*([1-9]|[1-4]\d|5[0-2])$/) ||
      raw.match(/^SEM_[\s\-]*([1-9]|[1-4]\d|5[0-2])$/) ||
      raw.match(/^SEMANA\s+([1-9]|[1-4]\d|5[0-2])$/) ||
      raw.match(/^W[K]?\s+([1-9]|[1-4]\d|5[0-2])$/);

    if (m) {
      const num = parseInt(m[1], 10);
      semanasVisibles.push({ num, index: i, th });
    }
  }

  // Si no hay ninguna semana renderizada, no hacemos nada
  if (!semanasVisibles.length) return;

  // --- Regla pedida: USAR LA PRIMERA SEMANA VISIBLE como "contada" ---
  const target = semanasVisibles[0];

  // --- Calcular estado relativo (vs. semana actual) ---
  let estado = "actual"; // "actual" | "retraso" | "adelanto"
  if (target.num !== semanaActual) {
    estado = (target.num < semanaActual) ? "retraso" : "adelanto";
  }

  // --- Pintar SOLO el TH objetivo, con clase por estado y badge de texto ---
  target.th.classList.add(
    estado === "actual"   ? "th-actual"   :
    estado === "retraso"  ? "th-retraso"  :
                            "th-adelanto"
  );

  const badge = document.createElement("span");
  badge.className = "estado-badge";
  badge.textContent = estado.charAt(0).toUpperCase() + estado.slice(1); // "Actual" | "Retraso" | "Adelanto"
  target.th.appendChild(document.createTextNode(" "));
  target.th.appendChild(badge);

  // (Opcional) exponer el estado para otros estilos si los necesitas
  document.body.dataset.estado = estado;
}

/********** 8) Estructuras de importación **********/
// clave "TIPO||NUEVOS" o "TIPO||<SEM>"
let __unicosPorClave = new Map(); // clave -> Set(códigos)
/** codeAttrs guarda Sets + máximos por código (robusto vs listas o enteros) */
let codeAttrs = new Map();        // código -> { ubicSet:Set, uaSet:Set, icFinal:string, ubicNumMax:number, uaNumMax:number }
let __ubicacionesPorClaveCount = new Map(); // (compatibilidad, no usado)

/********** 9) Conteo por vista **********/
function computeCountsByMetric(metric){
  const result = {};
  const breakdown = {}; // solo para "indicadores"

  for (const [clave, setCodes] of __unicosPorClave.entries()){
    const [tipo, s] = clave.split("||");
    const llave = (s === "NUEVOS") ? "NUEVOS" : parseInt(s, 10);
    if(!result[tipo]) result[tipo] = {};

    if (metric === "codigos"){
      result[tipo][llave] = (result[tipo][llave] || 0) + setCodes.size;

    } else if (metric === "ubicaciones"){
      let suma = 0;
      setCodes.forEach(c => {
        const attrs = codeAttrs.get(c) || {};
        const n = (attrs.ubicNumMax && Number.isFinite(attrs.ubicNumMax))
          ? attrs.ubicNumMax
          : (attrs.ubicSet ? attrs.ubicSet.size : 0);
        suma += n;
      });
      result[tipo][llave] = (result[tipo][llave] || 0) + suma;

    } else if (metric === "uas"){
      let suma = 0;
      setCodes.forEach(c => {
        const attrs = codeAttrs.get(c) || {};
        const n = (attrs.uaNumMax && Number.isFinite(attrs.uaNumMax))
          ? attrs.uaNumMax
          : (attrs.uaSet ? attrs.uaSet.size : 0);
        suma += n;
      });
      result[tipo][llave] = (result[tipo][llave] || 0) + suma;

    } else if (metric === "indicadores"){
      // Conteo A/B/C por código (orden A -> B -> C)
      const cnt = { A:0, B:0, C:0 };
      setCodes.forEach(c => {
        const v = (codeAttrs.get(c)?.icFinal || "").toString().trim().toUpperCase();
        if (v === "A" || v === "B" || v === "C") cnt[v]++;
      });
      if (!breakdown[tipo]) breakdown[tipo] = {};
      breakdown[tipo][llave] = cnt;
      result[tipo][llave] = (cnt.A + cnt.B + cnt.C) + (result[tipo][llave] || 0);
    }
  }
  return { counts: result, breakdown: (metric==="indicadores" ? breakdown : null) };
}

/********** 10) Modelo de tabla **********/
function getTableModel(metric="codigos"){
  const corteVista = verCorte.value;
  let semanasCandidatas = [];
  for(let s=1; s<=52; s++) semanasCandidatas.push(s);

  if (corteVista !== "TODOS"){
    semanasCandidatas = semanasCandidatas.filter(
      s => s >= cortes[corteVista].inicio && s <= cortes[corteVista].fin
    );
  }

  const { counts, breakdown } = computeCountsByMetric(metric);
  const tiposOrdenados = Array.from(new Set([...ORDERED_TYPES, ...Object.keys(counts)])).sort(compareTypes);

  // determinar qué semanas mostrar (solo las que tienen algo)
  const totalPorSemana = {}; semanasCandidatas.forEach(s => totalPorSemana[s] = 0);
  for(const t of tiposOrdenados){
    const data = counts[t] || {};
    for(const s of semanasCandidatas) totalPorSemana[s] += (data[s] || 0);
  }
  const semanas = semanasCandidatas.filter(s => (totalPorSemana[s]||0) > 0);

  const rows = []; const totalesSemana = {}; semanas.forEach(s => totalesSemana[s]=0);
  let totalNuevos = 0;

  for(const m of tiposOrdenados){
    const data = counts[m] || {};
    let totalFila = 0;
    const porSemana = {};

    semanas.forEach(s => {
      const v = data[s] || 0;
      porSemana[s] = v; totalFila += v; totalesSemana[s] += v;
    });

    const n = data.NUEVOS || 0; totalFila += n; totalNuevos += n;
    rows.push({ material:m, porSemana, nuevos:n, total:totalFila });
  }

  const showNuevos = totalNuevos > 0;
  const totalGeneral = Object.values(totalesSemana).reduce((a,b)=>a+b,0) + (showNuevos?totalNuevos:0);

  return { metric, semanas, rows, totalesSemana, totalNuevos, totalGeneral, corteVista, showNuevos, breakdown };
}

/********** 11) Render tabla (Indicadores compacto) **********/
function indicadoresCellHTML(total, det){
  const A = det?.A || 0;
  const B = det?.B || 0;
  const C = det?.C || 0;

  let indicadores = "";

  if (A > 0) indicadores += `<span class="ind-a">A:${A}</span>`;
  if (B > 0) indicadores += `<span class="ind-b">B:${B}</span>`;
  if (C > 0) indicadores += `<span class="ind-c">C:${C}</span>`;

  return `
    <div class="indicador-wrap">
      <div class="indicador-total">${total}</div>
      ${indicadores ? `<div class="indicador-det">${indicadores}</div>` : ""}
    </div>
  `.trim();
}

/** Valor que se muestra por celda */
function cellDisplay(metric, material, semKey, v, breakdown){
  if(metric !== "indicadores") return String(v);
  const det = breakdown?.[material]?.[semKey];
  // Retornamos HTML (sin esc) para una visual clara y compacta
  return indicadoresCellHTML(v, det);
}

function renderTabla(){
  const { metric, semanas, rows, totalesSemana, totalNuevos, totalGeneral, showNuevos, breakdown } = getTableModel(currentMetric);

  let thead="<thead><tr><th>Material</th>";
  semanas.forEach(s => thead+=`<th>SEM_${s}</th>`);
  if(showNuevos) thead += "<th>NUEVOS</th>";
  thead += "<th>Total</th></tr></thead>";

  let tbody="<tbody>";
  rows.forEach(r=>{
    tbody+=`<tr><td>${esc(r.material)}</td>`;
    semanas.forEach(s=>{
      const v=r.porSemana[s]||0;
      const content = (currentMetric==="indicadores")
        ? cellDisplay(currentMetric, r.material, s, v, breakdown) // HTML controlado
        : esc(cellDisplay(currentMetric, r.material, s, v, breakdown));
      tbody+=`<td class="${v===0?"cero":"pendiente"}">${content}</td>`;
    });
    if(showNuevos){
      const vN=r.nuevos||0;
      const contentN = (currentMetric==="indicadores")
        ? cellDisplay(currentMetric, r.material, "NUEVOS", vN, breakdown)
        : esc(cellDisplay(currentMetric, r.material, "NUEVOS", vN, breakdown));
      tbody+=`<td class="${vN===0?"cero":"pendiente"}">${contentN}</td>`;
    }
    tbody+=`<td class="total">${esc(r.total)}</td></tr>`;
  });

  tbody+=`<tr class="fila-total"><td><strong>TOTAL</strong></td>`;
  semanas.forEach(s=> tbody+=`<td><strong>${esc(totalesSemana[s]||0)}</strong></td>`);
  if(showNuevos) tbody+=`<td><strong>${esc(totalNuevos)}</strong></td>`;
  tbody+=`<td class="total-general"><strong>${esc(totalGeneral)}</strong></td></tr></tbody>`;

  document.getElementById("tabla").innerHTML =
    `<div class="tabla-scroll"><table>${thead}${tbody}</table></div>`;

  // 👇 Asegura repintado de la celda principal justo después del render
  setTimeout(iluminarSemana, 0);
}

/********** 12) Título de vista centrado **********/
function updateVistaTitulo(){
  const label = {
    codigos:"CÓDIGOS",
    ubicaciones:"UBICACIONES",
    uas:"UA’S",
    indicadores:"INDICADORES A/B/C"
  }[currentMetric] || currentMetric.toUpperCase();
  if(vistaTitulo) vistaTitulo.textContent = `VISTA: ${label}`;
}

/********** 13) Importación XLSX **********/
btnImportXlsx.onclick = async () => {
  try{
    if (bloqueado) return;
    const file = xlsxInput.files?.[0]; if(!file) return alert("Selecciona un archivo Excel (.xlsx).");

    for(let m in stock) delete stock[m];
    __unicosPorClave=new Map(); codeAttrs=new Map(); __ubicacionesPorClaveCount=new Map();

    const arrayBuff=await file.arrayBuffer();
    const wb=XLSX.read(arrayBuff,{type:"array"});
    const sheet=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:"", raw:true});
    if(!sheet.length) return alert("El archivo no tiene filas.");

    const headers=Object.keys(sheet[0]);
    const colCodigo=findHeader(headers,["codigo","código","code","id","item"]);
    const colTipo  =findHeader(headers,["tipomat","tipo material","tipomaterial","tipo"]);
    const colSemana=findHeader(headers,["semana","week","sem"]);
    const colEstado=findHeader(headers,["contado","contados","estado","estatus","pendiente","pendientes"]); // L
    const colStock =findHeader(headers,["stock","existencia","en existencia","estado stock","disponible"]);  // R
    if(!colCodigo||!colTipo||!colSemana||!colEstado||!colStock){
      return alert("El Excel debe incluir columnas: CODIGO, TIPOMAT, SEMANA, CONTADOS/ESTADO (L) y STOCK (R).");
    }
    const colUbic  =findHeader(headers,["ubicaciones","ubicación","ubicacion"]);
    const colUA    =findHeader(headers,["ua's","ua","uas","unidad administrativa"]);
    const colIcFin =findHeader(headers,["icfinal","ic final","indicador","tipo indicador"]);

    const setUnicos=new Map();

    for(const row of sheet){
      const estadoRaw=(row[colEstado]??"").toString().trim().toLowerCase();
      if(["contado","contados","procesado","hecho"].includes(estadoRaw)) continue;
      if(!tieneExistencia(row[colStock])) continue;

      const tipoRaw=normalizeTipo(row[colTipo]);
      const semInfo=parseSemanaCell(row[colSemana]);
      if(!tipoRaw||!semInfo) continue;

      const cod=(row[colCodigo]??"").toString().trim(); if(!cod) continue;

      // --- Atributos por código (sumatorio por código) ---
      const ic = colIcFin ? (row[colIcFin]??"").toString().trim().toUpperCase() : "";
      const prev = codeAttrs.get(cod) || {
        ubicNumMax: 0, uaNumMax: 0,
        ubicSet: new Set(), uaSet: new Set(),
        icFinal: ""
      };

      // UBICACIONES
      if (colUbic){
        const rawU = row[colUbic];
        if (isPureIntegerCell(rawU)){
          prev.ubicNumMax = Math.max(prev.ubicNumMax, asInt(rawU));
        } else {
          splitMulti(rawU).forEach(u => prev.ubicSet.add(u));
        }
      }

      // UA's
      if (colUA){
        const rawA = row[colUA];
        if (isPureIntegerCell(rawA)){
          prev.uaNumMax = Math.max(prev.uaNumMax, asInt(rawA));
        } else {
          splitMulti(rawA).forEach(u => prev.uaSet.add(u));
        }
      }

      // Indicador
      if (ic) prev.icFinal = ic;

      codeAttrs.set(cod, prev);

      const clave = (semInfo.tipo==="nuevos") ? `${tipoRaw}||NUEVOS` : `${tipoRaw}||${semInfo.semana}`;
      if(!setUnicos.has(clave)) setUnicos.set(clave,new Set());
      setUnicos.get(clave).add(cod);
    }

    __unicosPorClave=setUnicos;

    // Base "stock" (vista Códigos) — persistencia local (compat)
    const nuevosPorTipo={}; const conteoPorSemana={};
    for(const [key,set] of setUnicos.entries()){
      const [tipo,s]=key.split("||");
      if(s==="NUEVOS"){ nuevosPorTipo[tipo]=(nuevosPorTipo[tipo]||0)+set.size; }
      else { const sem=parseInt(s,10); (conteoPorSemana[tipo]??={})[sem]=((conteoPorSemana[tipo][sem]||0)+set.size); }
    }
    const tipos=new Set([...Object.keys(nuevosPorTipo),...Object.keys(conteoPorSemana)]);
    tipos.forEach(tipo=>{
      stock[tipo]={NUEVOS:0};
      if(nuevosPorTipo[tipo]!=null) stock[tipo].NUEVOS=nuevosPorTipo[tipo];
      if(conteoPorSemana[tipo]) for(const [sem,n] of Object.entries(conteoPorSemana[tipo])) stock[tipo][parseInt(sem,10)]=n;
    });

    guardar(); renderTabla(); updateVistaTitulo(); applyViewClass();
    // Al cambiar a Indicadores, se mostrará el resumen (ver setView)
    panelResumen.innerHTML="";

    saveModelToStorage()
    guardarUI(); // persistimos inmediatamente vista y scroll tras importar

    alert("Importación completada. Se contaron PENDIENTES con EXISTENCIA. 'Contados' y 'Sin Existencia' se excluyeron.");
  }catch(err){ console.error(err); alert(`No se pudo importar el Excel. Detalle: ${err.message||err}`); }
};

/********** 14) Panel resúmenes y cambio de vista **********/
/**
 * Cuenta cuántos códigos hay por valor de un campo de codeAttrs
 * (ej.: icFinal). Respeta el corte activo.
 */
function buildConteoPorCampo(campo, normalizar=(v)=>v||"(Sin dato)"){
  const conteo=new Map();
  const corte=verCorte.value; let rango=null; if(corte!=="TODOS") rango=cortes[corte];
  for(const [clave,setCods] of __unicosPorClave.entries()){
    const [,s]=clave.split("||"); const esNuevos=(s==="NUEVOS"); const semNum=parseInt(s,10);
    if(esNuevos || !rango || (semNum>=rango.inicio && semNum<=rango.fin)){
      setCods.forEach(cod=>{
        const raw=(codeAttrs.get(cod)?.[campo]??"").toString().trim(); // p.ej. icFinal
        const val=normalizar(raw);
        conteo.set(val, (conteo.get(val)||0)+1);
      });
    }
  }
  return Array.from(conteo.entries()).sort((a,b)=>b[1]-a[1]);
}

/**
 * Renderiza una tabla de resumen. Modo especial "indicadores":
 * - compacta
 * - filas con color A/B/C para que resalten
 */
function renderResumenTabla(titulo, data, kind="default"){
  const extraClass = kind === "indicadores" ? " resumen--indicadores" : "";
  const rowsHtml = data.map(([k,v])=>{
    const rowClass = (kind==="indicadores")
      ? (k==="A"?"row-a":k==="B"?"row-b":k==="C"?"row-c":"row-otros")
      : "";
    return `<tr class="${rowClass}"><td>${esc(k)}</td><td class="total">${esc(v)}</td></tr>`;
  }).join("");

  return `
    <div class="tabla-scroll resumen-panel">
      <table class="resumen${extraClass}">
        <thead><tr><th>${esc(titulo)}</th><th>Cantidad</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="2">(Sin registros)</td></tr>`}</tbody>
      </table>
    </div>`;
}

function setView(metric, withPanel=false){
// marcar botón activo visualmente
document.querySelectorAll(".btn-vista").forEach(b => b.classList.remove("btn-activo"));

if(metric === "codigos") btnCodigos.classList.add("btn-activo");
if(metric === "ubicaciones") btnUbicaciones.classList.add("btn-activo");
if(metric === "uas") btnUAs.classList.add("btn-activo");
if(metric === "indicadores") btnIndicadores.classList.add("btn-activo");

  currentMetric=metric; renderTabla(); updateVistaTitulo(); applyViewClass(); guardarUI();

  if (metric === "indicadores"){
    // SIEMPRE mostrar el resumen A/B/C (compacto y que resalte)
    const normI = (v) => {
      const up = (v||"").toString().trim().toUpperCase();
      return ["A","B","C"].includes(up)? up : (up? up : "(Sin dato)");
    };
    const data = buildConteoPorCampo("icFinal", normI); // [["A",n],["B",m],...]
    const mapa = new Map(data);
    const orderedABC = [
      ["A", mapa.get("A") || 0],
      ["B", mapa.get("B") || 0],
      ["C", mapa.get("C") || 0]
    ];
    const otros = data.filter(([k]) => !["A","B","C"].includes(k));
    panelResumen.innerHTML = renderResumenTabla("Indicadores (A/B/C)", [...orderedABC, ...otros], "indicadores");
  } else {
    panelResumen.innerHTML = "";
  }
}
// reiniciar rotación desde la vista actual
if(rotationTimer){
  iniciarRotacionAutomatica();
}
btnCodigos.onclick     = () => { if(bloqueado) return; setView("codigos", false); };
btnUbicaciones.onclick = () => { if(bloqueado) return; setView("ubicaciones", false); };
btnUAs.onclick         = () => { if(bloqueado) return; setView("uas", false); };
btnIndicadores.onclick = () => { if(bloqueado) return; setView("indicadores", true); };

/********** 15) Envío de correo (estilo unificado + resumen) **********/
const CLIENT_ID="PON_AQUI_TU_CLIENT_ID"; // si usas Graph, reemplázalo
const TENANT_ID_OPCIONAL=null;
const AUTH_AUTHORITY=`https://login.microsoftonline.com/${TENANT_ID_OPCIONAL||"common"}`;
const REDIRECT_URI=window.location.origin;
const GRAPH_SCOPES=["Mail.ReadWrite"];
const EMAIL_TO=""; const EMAIL_CC="";
const OUTLOOK_HOST="https://outlook.office.com";

const msalInstance=(window.msal && typeof window.msal.PublicClientApplication==="function")
? new msal.PublicClientApplication({auth:{clientId:CLIENT_ID,authority:AUTH_AUTHORITY,redirectUri:REDIRECT_URI},cache:{cacheLocation:"localStorage",storeAuthStateInCookie:true}})
: null;

function parseRecipients(str){ return (str||"").split(/[;,]+/).map(s=>s.trim()).filter(Boolean); }
async function getAccount(){ if(!msalInstance) throw new Error("MSAL no disponible"); await msalInstance.initialize(); const accs=msalInstance.getAllAccounts(); if(accs.length) return accs[0]; const login=await msalInstance.loginPopup({scopes:GRAPH_SCOPES}); return login.account; }
async function getToken(){ const account=await getAccount(); try{ const r=await msalInstance.acquireTokenSilent({account,scopes:GRAPH_SCOPES}); return r.accessToken; }catch{ const r=await msalInstance.acquireTokenPopup({account,scopes:GRAPH_SCOPES}); return r.accessToken; } }
async function createDraftWithHtml({subject,html,to,cc}){
  const token=await getToken();
  const toRecipients=parseRecipients(to).map(a=>({emailAddress:{address:a}}));
  const ccRecipients=parseRecipients(cc).map(a=>({emailAddress:{address:a}}));
  const res=await fetch("https://graph.microsoft.com/v1.0/me/messages",{method:"POST",headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({subject,body:{contentType:"HTML",content:html},toRecipients,ccRecipients})});
  if(!res.ok){ const t=await res.text(); throw new Error(`Graph /me/messages falló: ${res.status} ${t}`); }
  return res.json();
}
function openOutlookComposeById(messageId){
  const encId=encodeURIComponent(messageId);
  const url=`${OUTLOOK_HOST}/mail/deeplink/compose/${encId}?ItemID=${encId}&exvsurl=1`;
  const win=window.open(url,"_blank","noopener,noreferrer");
  return !!win;
}
function downloadEml(subject, html, to, cc){
  const headers=[
    to?`To: ${to}`:null,
    cc?`Cc: ${cc}`:null,
    `Subject: ${subject}`,
    "X-Unsent: 1","MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ].filter(Boolean).join("\r\n");
  const eml=headers+"\r\n\r\n"+html; const blob=new Blob([eml],{type:"message/rfc822"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; const fecha=new Date().toISOString().slice(0,10);
  a.download=`${subject.replace(/[\\/:*?"<>|]+/g,"-")}_${fecha}.eml`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/** HTML compacto de Indicadores para correo (inline styles, email-safe) */
function indicadoresEmailCellHTML(total, det){
  const A = det?.A || 0;
  const B = det?.B || 0;
  const C = det?.C || 0;

  let indicadores = "";

  if (A > 0) {
    indicadores += `<span style="background:#00c853;color:#001a0d;padding:1px 4px;border-radius:3px">A:${A}</span>`;
  }

  if (B > 0) {
    indicadores += `<span style="background:#ffd600;color:#1a1200;padding:1px 4px;border-radius:3px">B:${B}</span>`;
  }

  if (C > 0) {
    indicadores += `<span style="background:#ff3d00;color:#ffffff;padding:1px 4px;border-radius:3px">C:${C}</span>`;
  }

  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="font-weight:900">${total}</div>
      ${indicadores ? `<div style="display:flex;gap:6px;font-size:11px;font-weight:700">${indicadores}</div>` : ""}
    </div>
  `.trim();
}

/** Construye resumen A/B/C (con el mismo filtro de corte activo) */
function computeIndicadoresResumen(){
  // Reutilizamos buildConteoPorCampo para contar por icFinal, respetando el corte seleccionado
  const normI = (v) => {
    const up = (v||"").toString().trim().toUpperCase();
    return ["A","B","C"].includes(up)? up : (up? up : "(Sin dato)");
  };
  const data = buildConteoPorCampo("icFinal", normI); // [["A",n],["B",m],...]
  const mapa = new Map(data);
  // Orden fijo A -> B -> C; luego "otros" si existieran
  const orderedABC = [
    ["A", mapa.get("A") || 0],
    ["B", mapa.get("B") || 0],
    ["C", mapa.get("C") || 0]
  ];
  const otros = data.filter(([k]) => !["A","B","C"].includes(k));
  return [...orderedABC, ...otros];
}

/** Renderiza el "cuadrito" de resumen A/B/C al estilo de las tablas del correo */
function renderIndicadoresSummaryEmail(S){
  const resumen = computeIndicadoresResumen(); // [["A",n],["B",m],["C",x],...]
  const rows = resumen.map(([k,v]) =>
    `<tr>
      <td ${S.tdVal}>${esc(k)}</td>
      <td ${S.tdTotal}><strong>${esc(v)}</strong></td>
    </tr>`
  ).join("");

  return `
    <h3 style="font-family:Arial,Helvetica,sans-serif;color:#0b1741;margin:16px 0 8px 0;">
      Indicadores (A/B/C) — Resumen
    </h3>
    <table ${S.baseTbl}>
      <thead>
        <tr>
          <th ${S.th}>Indicador</th>
          <th ${S.th}>Cantidad</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td ${S.tdVal} colspan="2">(Sin registros)</td></tr>`}
      </tbody>
    </table>
  `.trim();
}

/** Genera el HTML del correo (todas las vistas con el mismo estilo + resumen de indicadores) */
function buildEmailHtml(){
  const { corteVista } = getTableModel(currentMetric);
  const fecha = new Date().toLocaleDateString();

  // Un solo tema para todas las tablas (unificado)
  const S = {
    baseTbl: 'border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;background:#ffffff;color:#111111"',
    th:     'style="background:#0b1741;color:#0ff8ff;text-align:center;border:1px solid #0d1b3c;padding:8px"',
    tdVal:  'style="text-align:center;border:1px solid #0d1b3c;padding:8px"',
    tdZero: 'style="text-align:center;border:1px solid #0d1b3c;padding:8px;color:#0a7a45;background:#eafff4;font-weight:bold"',
    tdTotal:'style="text-align:center;border:1px solid #0d1b3c;padding:8px;font-weight:bold;color:#0bbcff;background:#0f203a"',
    tdTotalGeneral:'style="text-align:center;border:2px solid #ffd400;padding:12px 10px;font-weight:900;color:#1a0d10;background:#ffef5a"'
  };

  // Render genérico de una tabla por métrica
  function renderTableSection(metric){
    const { semanas, rows, totalesSemana, totalNuevos, totalGeneral, showNuevos, breakdown } = getTableModel(metric);

    const thead =
      `<tr>
        <th ${S.th}>Material</th>
        ${semanas.map(s=>`<th ${S.th}>SEM_${s}</th>`).join("")}
        ${showNuevos?`<th ${S.th}>NUEVOS</th>`:""}
        <th ${S.th}>Total</th>
      </tr>`;

    const cuerpo = rows.map(r => {
      const celdasSemanas = semanas.map(s=>{
        const v = r.porSemana[s] || 0;
        const content = (metric==="indicadores")
          ? indicadoresEmailCellHTML(v, breakdown?.[r.material]?.[s]) // compacto y legible en email
          : String(v);
        return `<td ${(v===0? S.tdZero : S.tdVal)}>${content}</td>`;
      }).join("");

      const celdaNuevos = showNuevos ? (() => {
        const vN = r.nuevos || 0;
        const contentN = (metric==="indicadores")
          ? indicadoresEmailCellHTML(vN, breakdown?.[r.material]?.["NUEVOS"])
          : String(vN);
        return `<td ${(vN===0? S.tdZero : S.tdVal)}>${contentN}</td>`;
      })() : "";

      return `
        <tr>
          <td ${S.tdVal}>${esc(r.material)}</td>
          ${celdasSemanas}
          ${celdaNuevos}
          <td ${S.tdTotal}>${esc(r.total)}</td>
        </tr>`;
    }).join("");

    const filaTotal =
      `<tr>
        <td ${S.tdTotal}><strong>TOTAL</strong></td>
        ${semanas.map(s=>`<td ${S.tdTotal}><strong>${esc(totalesSemana[s]||0)}</strong></td>`).join("")}
        ${showNuevos?`<td ${S.tdTotal}><strong>${esc(totalNuevos)}</strong></td>`:""}
        <td ${S.tdTotalGeneral}><strong>${esc(totalGeneral)}</strong></td>
      </tr>`;

    const tabla =
      `<table ${S.baseTbl}>
        <thead>${thead}</thead>
        <tbody>${cuerpo}${filaTotal}</tbody>
      </table>`.trim();

    const titulo = `<h3 style="font-family:Arial,Helvetica,sans-serif;color:#0b1741;margin:16px 0 8px 0;">Tabla: ${{
      codigos:"CÓDIGOS", ubicaciones:"UBICACIONES", uas:"UA’S", indicadores:"INDICADORES A/B/C"
    }[metric] || metric.toUpperCase()}</h3>`;

    return `${titulo}\n${tabla}`;
  }

  // Cabecera simple
  const header =
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;margin:0 0 12px 0;">
      <strong>Estado de Conteo</strong> · ${fecha} · ${esc(corteVista)} · Vistas: CÓDIGOS · UBICACIONES · UA’S · INDICADORES
    </p>`;

  // Construimos las 4 tablas (estilo unificado) y, al final de Indicadores, agregamos el cuadrito resumen A/B/C
  const tablaCodigos      = renderTableSection("codigos");
  const tablaUbicaciones  = renderTableSection("ubicaciones");
  const tablaUAs          = renderTableSection("uas");
  const tablaIndicadores  = renderTableSection("indicadores");
  const resumenIndicEmail = renderIndicadoresSummaryEmail(S);

  const bloques = [
    tablaCodigos,
    '<div style="height:16px"></div>',
    tablaUbicaciones,
    '<div style="height:16px"></div>',
    tablaUAs,
    '<div style="height:16px"></div>',
    tablaIndicadores,
    resumenIndicEmail            // 👈 cuadrito agregado al final
  ].join('');

  // HTML final
  return `<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:13px;background:#ffffff;color:#111111;">
    ${header}
    ${bloques}
  </body></html>`.trim();
}

btnEmail.onclick = async () => {
  if (bloqueado) return;

  // Semana ISO actual
  const semanaISO = getISOWeek(new Date());
  const { corteVista } = getTableModel(currentMetric);

  const subject = `Estado de conteo · SEMANA ${semanaISO} · ${corteVista} · BEL-STAR`;
  const html = buildEmailHtml();

  // ✅ DESTINATARIOS (AQUÍ MISMO)
  const TO = "supervisoresenem@belcorp.biz";
  const CC = "manuelpinilla@belcorp.biz; sciclicos@belcorp.biz";

  if (!msalInstance || !CLIENT_ID || CLIENT_ID.startsWith("PON_AQUI")) {
    downloadEml(subject, html, TO, CC);
    return;
  }

  try {
    const draft = await createDraftWithHtml({
      subject,
      html,
      to: TO,
      cc: CC
    });
    const opened = openOutlookComposeById(draft.id);
    if (!opened) downloadEml(subject, html, TO, CC);
  } catch (err) {
    console.error("[Graph fallback -> EML] ", err);
    downloadEml(subject, html, TO, CC);
  }
};

/********** 16) Arranque de la macro **********/
const _restored = restoreModelFromStorage();
renderTabla();
updateVistaTitulo();
applyViewClass();
restaurarUI();
iniciarListenerFirebase();
// Si este computador ya tiene datos cargados, los sube a Firebase de inmediato
if (_restored) {
  saveModelToStorage();
}

// iniciar rotación automática de vistas
setTimeout(iniciarRotacionAutomatica, 2000);

// Guardado de scroll durante el uso (anti reset con suavizado)
let __scrollTimer = null;
window.addEventListener("scroll", () => {
  clearTimeout(__scrollTimer);
  __scrollTimer = setTimeout(guardarUI, 150);
}, { passive:true });

const btnMacro = document.getElementById("btnMacro");

if (btnMacro) {
  btnMacro.onclick = async () => {

    if (bloqueado) {
      alert("🔒 Debes desbloquear primero");
      return;
    }

// 🔥 AQUÍ VA LA LÍNEA
iniciarProgreso();
console.log("🔥 PROGRESO INICIADO");
console.log("🚀 LLAMANDO A API MACRO");
    // 🔥 ACTIVAR COLOR AMARILLO (CLAVE)
    btnMacro.classList.add("btn-macro-running");

    btnMacro.disabled = true;
    btnMacro.textContent = "⏳ Ejecutando macro...";

    try {

      const res = await fetch("http://127.0.0.1:3000/api/run-macro", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-enem-token": "ENEM_SECURE_2026"
        }
      });

      const data = await res.json();

      if (data.success) {

        // ✅ NO recargar, la macro tarda 15 min
        iniciarMonitoreo();

      } else {
        alert("❌ ERROR REAL:\n\n" + data.error);
        throw new Error(data.error || "Error desconocido");
      }

    } catch (err) {
      console.error(err);

      alert("❌ ERROR CAPTURADO:\n\n" + err.message);

      // ❌ si falla, devolver botón a normal
      btnMacro.classList.remove("btn-macro-running");
      btnMacro.disabled = false;
      btnMacro.textContent = "⚙️ Ejecutar Macro";
    }

  };
}
// ========= 🔥 BARRA DE PROGRESO, GUARDAR REFERENCIA DEL PROGRESO =========

let progressInterval = null;

// ✅ FUNCIÓN DE PROGRESO

function iniciarProgreso() {

  const container = document.getElementById("progressContainer");
  const bar = document.getElementById("progressBar");
  const text = document.getElementById("progressText");

  // 🔥 Validación segura
  if (!container || !bar || !text) {
    console.warn("⚠️ Barra no encontrada");
    return;
  }

  container.style.display = "block";

  let progreso = 0;

  progressInterval = setInterval(async () => {

  try {

    const res = await fetch("http://127.0.0.1:3000/api/macro-status");
    const data = await res.json();

    // ✅ SI SIGUE CORRIENDO
    if (data.running) {

      bar.style.width = "50%";
      text.innerText = "⏳ Macro en ejecución...";

    }

    // ✅ SI YA TERMINÓ (pero aún no llegó iniciarMonitoreo)
    else {

      bar.style.width = "90%";
      text.innerText = "⚙️ Finalizando proceso...";

    }

  } catch (err) {
    console.error("Error progreso:", err);
  }

}, 3000);

}


/********** 🔥 MONITOREO DE MACRO **********/
async function iniciarMonitoreo() {

  const interval = setInterval(async () => {

    try {

      const res = await fetch("http://127.0.0.1:3000/api/macro-status");
      const data = await res.json();

      if (!data.running) {
        console.log("STATUS FINAL:", data);

        clearInterval(interval);
        // 🔥 DETENER PROGRESO VISUAL
if (progressInterval) {
  clearInterval(progressInterval);
  progressInterval = null;
}

// 🔥 FORZAR BARRA A 100%
const bar = document.getElementById("progressBar");
const text = document.getElementById("progressText");

if (bar && text) {
  bar.style.width = "100%";
  text.innerText = "✅ Macro finalizada";
}

        // ✅ QUITAR COLOR AMARILLO
        btnMacro.classList.remove("btn-macro-running");
        btnMacro.disabled = false;

        if (data.result === "OK") {

  btnMacro.textContent = "✅ Procesando archivo...";

  // ⏱️ Esperar unos segundos para asegurar que Excel ya guardó
  (async () => {
  try {

    const response = await fetch("http://127.0.0.1:3000/api/get-excel");

    if (!response.ok) throw new Error("No se pudo obtener el archivo");

    const blob = await response.blob();

    const file = new File([blob], "LX_APP.xlsx", { type: blob.type });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    xlsxInput.files = dataTransfer.files;

    // ✅ Importación automática
    btnImportXlsx.click();

    btnMacro.textContent = "✅ Macro + Importación completa";
    // 🔥 FORZAR REFRESCO COMPLETO DE VISTA (CLAVE)
setTimeout(() => {

  try {

    // ✅ volver a renderizar tabla
    renderTabla();

    // ✅ recalcular semana
    iluminarSemana();

    // ✅ actualizar título
    updateVistaTitulo();

    // ✅ limpiar resumen anterior
    panelResumen.innerHTML = "";

    console.log("✅ UI refrescada correctamente");

  } catch (err) {
    console.error("❌ Error refrescando UI:", err);
  }

}, 500);
// 🔥 SCROLL ARRIBA (para efecto visual limpio)
window.scrollTo({ top: 0, behavior: "smooth" });

// 🔥 RESET COMPLETO DEL SISTEMA (CRÍTICO)
setTimeout(() => {

  // ✅ botón listo para reutilizar
  btnMacro.classList.remove("btn-macro-running");
  btnMacro.disabled = false;
  btnMacro.textContent = "⚙️ Ejecutar Macro";

  // ✅ ocultar barra de progreso
  const container = document.getElementById("progressContainer");
  if (container) {
    container.style.display = "none";
  }

}, 3000);
  } catch (err) {

    console.error(err);

    alert("❌ Error cargando archivo automático");

    btnMacro.textContent = "❌ Error importación";

  }
})();
}
 else {

          btnMacro.textContent = "❌ Error Macro";
          alert("❌ ERROR REAL:\n\n" + data.error);
          console.log("ERROR COMPLETO:", data);

        }

      }

    } catch (err) {
      console.error("Error monitoreo:", err);
    }

  }, 10000); // cada 10 seg
}


// Guardar estado al salir
window.addEventListener("beforeunload", () => {
  if (!isSafeReload) {
    guardarUI();
  }
});