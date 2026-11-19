# Instala el lanzador "KROHN Desktop" y su acceso directo en el escritorio.
#
#   powershell -ExecutionPolicy Bypass -File packaging\desktop\install-desktop-shortcut.ps1
#
# Idempotente: copia el .ps1 y el .vbs a %LOCALAPPDATA%\krohn, copia el icono y
# (re)crea el .lnk del escritorio apuntando a wscript.exe.

$ErrorActionPreference = "Stop"

$Here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo   = Resolve-Path (Join-Path $Here "..\..")
$Target = Join-Path $env:LOCALAPPDATA "krohn"
New-Item -ItemType Directory -Force -Path $Target | Out-Null

Copy-Item (Join-Path $Here "krohn-desktop.ps1") (Join-Path $Target "krohn-desktop.ps1") -Force
Copy-Item (Join-Path $Here "krohn-desktop.vbs") (Join-Path $Target "krohn-desktop.vbs") -Force

$IconSrc = Join-Path $Repo "apps\desktop\assets\icon.ico"
$IconDst = Join-Path $Target "krohn-desktop.ico"
if (Test-Path $IconSrc) { Copy-Item $IconSrc $IconDst -Force }

$Desktop  = [Environment]::GetFolderPath("Desktop")
$Shortcut = Join-Path $Desktop "KROHN Desktop.lnk"
$Shell    = New-Object -ComObject WScript.Shell
$Lnk      = $Shell.CreateShortcut($Shortcut)
$Lnk.TargetPath       = "$env:WINDIR\System32\wscript.exe"
$Lnk.Arguments        = '"' + (Join-Path $Target "krohn-desktop.vbs") + '"'
$Lnk.WorkingDirectory = "$Repo"
$Lnk.Description      = "KROHN Desktop - agente personal"
if (Test-Path $IconDst) { $Lnk.IconLocation = $IconDst }
$Lnk.Save()

Write-Host "Acceso directo creado: $Shortcut"
