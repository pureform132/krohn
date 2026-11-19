# KROHN Editorial UI (+ MEGANOTE) — deploy/restore on this machine's KROHN home.
#
# `krohn update` / the web build wipes `krohn_cli/web_dist/index.html` (it is generated
# from web/). Run this after every update to restore the Editorial UI and MEGANOTE.
#
#   powershell -ExecutionPolicy Bypass -File packaging\lightui\deploy.ps1
#
# What it does (idempotent):
#   1. Backs up the currently served index.html to %TEMP%\krohn-webdist-backup-<ts>\
#   2. Copies packaging\lightui\krohn-editorial.html as web_dist\index.html
#   3. Copies web\public\meganote\* into web_dist\meganote\
#   4. Regenerates the KROHN chibi sprite at web_dist\krohn-chibi.png
# Restore the previous light UI instead: point krohn-editorial.html -> krohn-light-ui.html below.
# Restore the stock SPA: delete web_dist\index.html, then run `krohn dashboard --stop` and `krohn dashboard`.

$ErrorActionPreference = "Stop"
$UI_FILE = "krohn-editorial.html"

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dist = "$env:LOCALAPPDATA\krohn\krohn\krohn_cli\web_dist"
if (-not (Test-Path $dist)) { throw "web_dist not found at $dist - is KROHN installed?" }

$backup = "$env:TEMP\krohn-webdist-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force $backup | Out-Null
if (Test-Path "$dist\index.html") { Copy-Item "$dist\index.html" "$backup\index.html" -Force }
if (Test-Path "$dist\meganote") { Copy-Item "$dist\meganote" "$backup\meganote" -Recurse -Force }

Copy-Item (Join-Path $PSScriptRoot $UI_FILE) "$dist\index.html" -Force
$meganoteSrc = Join-Path $repo "web\public\meganote"
$meganoteDst = Join-Path $dist "meganote"
New-Item -ItemType Directory -Force $meganoteDst | Out-Null
Copy-Item "$meganoteSrc\*" $meganoteDst -Recurse -Force

Add-Type -AssemblyName System.Drawing
$petSrc = Join-Path $repo "packaging\pets\krohn-chibi\spritesheet.png"
$petDst = Join-Path $dist "krohn-chibi.png"
$petDstRepo = Join-Path $PSScriptRoot "krohn-chibi.png"
$srcImg = [System.Drawing.Image]::FromFile($petSrc)
$bmp = New-Object System.Drawing.Bitmap 576, 684, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($srcImg, 0, 0, 576, 684)
$g.Dispose(); $srcImg.Dispose()
$bmp.Save($petDst, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save($petDstRepo, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

"deployed: $UI_FILE + meganote\ + pet -> $dist"
"backup:   $backup"
