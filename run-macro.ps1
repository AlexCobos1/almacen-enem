# =========================================
# run-macro.ps1 (FINAL CON DETECCIÓN REAL)
# =========================================

$ErrorActionPreference = "Stop"

# ===============================
# 🔧 CONFIGURACIÓN
# ===============================
$LocalFile = "C:\Users\digerienem\OneDrive - CETCO S.A\Archivos digerienem 2025\Escritorio\SAP_EXPORTS\APROY.xlsm"
$MacroName = "Ejecutar_Mi_Script"

# ✅ Archivo flag
$flagFile = "C:\Users\digerienem\OneDrive - CETCO S.A\Archivos digerienem 2025\Escritorio\SAP_EXPORTS\macro_done.txt"

# ===============================
# 🔧 VARIABLES INTERNAS
# ===============================
$excel = $null
$workbook = $null

try {

    # =========================================
    # ✅ VALIDAR ARCHIVO
    # =========================================
    if (-Not (Test-Path $LocalFile)) {
        throw "Archivo no existe: $LocalFile"
    }

    # =========================================
    # 🔥 LIMPIAR FLAG ANTERIOR
    # =========================================
    if (Test-Path $flagFile) {
        Remove-Item $flagFile -Force
    }

    # =========================================
    # 🔥 FIX ONEDRIVE
    # =========================================
    attrib +P "$LocalFile"
    $null = Get-Content "$LocalFile"

    # =========================================
    # 🚀 INICIAR EXCEL
    # =========================================
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false

    # =========================================
    # 📂 ABRIR ARCHIVO
    # =========================================
    $workbook = $excel.Workbooks.Open("$LocalFile")

    # =========================================
    # ⏳ ESPERA INTELIGENTE
    # =========================================
    $maxWait = 60
    $elapsed = 0

    while ($excel.Ready -ne $true -and $elapsed -lt $maxWait) {
        Start-Sleep -Milliseconds 500
        $elapsed += 0.5
    }

    Start-Sleep -Seconds 10

    $workbook.Activate()
    Start-Sleep -Seconds 5

    # =========================================
    # ⚙️ RUN MACRO (CON REINTENTO)
    # =========================================
    try {
        $excel.Run("$($workbook.Name)!$MacroName")
    }
    catch {
        Start-Sleep -Seconds 10
        $excel.Run("$($workbook.Name)!$MacroName")
    }

    # =========================================
    # ⏳ ESPERA REAL A FINALIZACIÓN
    # =========================================
    $timeout = 600   # 🔴 10 minutos máximo
    $elapsed = 0

    while (-Not (Test-Path $flagFile) -and $elapsed -lt $timeout) {
        Start-Sleep -Seconds 1
        $elapsed++
    }

    if (-Not (Test-Path $flagFile)) {
        throw "La macro no generó señal de finalización"
    }

    # =========================================
    # 💾 CIERRE CONTROLADO
    # =========================================
    $workbook.Close($true)
    $excel.Quit()

    Write-Output "OK"
}
catch {
    Write-Output "ERROR: $($_.Exception.Message)"
    exit 1
}
finally {

    if ($workbook) {
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
    }

    if ($excel) {
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
    }
}