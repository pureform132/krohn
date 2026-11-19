# KROHN light UI + MEGANOTE — deploy/restore on this machine's KROHN home.
#
# `krohn update` / the web build wipes `krohn_cli/web_dist/index.html` (it is generated
# from web/). Run this after every update to restore the light UI and MEGANOTE.
#
#   powershell -ExecutionPolicy Bypass -File packaging\lightui\deploy.ps1
#
# What it does (idempotent):
#   1. Backs up the currently served index.html to %TEMP%\krohn-webdist-backup-<ts>\
#   2. Copies the light UI (packaging\lightui\krohn-light-ui.html) as web_dist\index.html
#   3. Copies web\public\meganote\* into web_dist\meganote\
#   4. Copies the Ultron chibi spritesheet as web_dist\krohn-ultron-chibi.png
# Restore the stock SPA instead:
#   Remove-Item $env:LOCALAPPDATA\krohn\krohn\krohn_cli\web_dist\index.html
#   & "$env:LOCALAPPDATA\krohn\bin\krohn.exe" dashboard --stop
#   krohn dashboard   # rebuild + serve the stock app

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dist = "$env:LOCALAPPDATA\krohn\krohn\krohn_cli\web_dist"
if (-not (Test-Path $dist)) { throw "web_dist not found at $dist - is KROHN installed?" }

$backup = "$env:TEMP\krohn-webdist-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force $backup | Out-Null
if (Test-Path "$dist\index.html") { Copy-Item "$dist\index.html" "$backup\index.html" -Force }
if (Test-Path "$dist\meganote") { Copy-Item "$dist\meganote" "$backup\meganote" -Recurse -Force }

Copy-Item (Join-Path $PSScriptRoot "krohn-light-ui.html") "$dist\index.html" -Force
$meganoteSrc = Join-Path $repo "web\public\meganote"
$meganoteDst = Join-Path $dist "meganote"
New-Item -ItemType Directory -Force $meganoteDst | Out-Null
Copy-Item "$meganoteSrc\*" $meganoteDst -Recurse -Force
$pet = Join-Path $repo "packaging\pets\krohn-ultron-chibi\spritesheet.png"
Copy-Item $pet "$dist\krohn-ultron-chibi.png" -Force

"deployed: index.html + meganote\ + pet -> $dist"
"backup:   $backup"
