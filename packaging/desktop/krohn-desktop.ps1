# KROHN Desktop - arranca el backend si hace falta y abre la interfaz como app.
#
# Uso normal: doble clic en el acceso directo "KROHN Desktop" del escritorio.
# El lanzador es idempotente: si el dashboard ya responde, solo abre la ventana.

$ErrorActionPreference = "SilentlyContinue"

$Base   = "http://127.0.0.1:9119"
$Health = "$Base/api/health"
$Krohn  = Join-Path $env:LOCALAPPDATA "krohn\bin\krohn.exe"

function Test-KrohnUp {
  try {
    return (Invoke-WebRequest -Uri $Health -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-KrohnUp)) {
  if (Test-Path $Krohn) {
    Start-Process -FilePath $Krohn -ArgumentList "dashboard", "--skip-build", "--no-open" -WindowStyle Hidden
  }
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Milliseconds 1000
    if (Test-KrohnUp) { break }
  }
}

$Edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $Edge)) { $Edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" }

if (Test-Path $Edge) {
  $ProfileDir = Join-Path $env:LOCALAPPDATA "krohn\desktop-shell"
  Start-Process -FilePath $Edge -ArgumentList @(
    "--app=$Base/",
    "--window-size=1440,900",
    "--window-position=60,40",
    "--user-data-dir=$ProfileDir",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=msEdgeSidebarV2,msEdgeWelcomePage"
  )
} else {
  Start-Process $Base
}
