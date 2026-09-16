$ErrorActionPreference = "Stop"

$release = "chromium/7763"
$archive = "pdfium-win-x64.tgz"
$url     = "https://github.com/bblanchon/pdfium-binaries/releases/download/$release/$archive"

$tmp = Join-Path $env:TEMP "pdfium-download"
New-Item -ItemType Directory -Force $tmp | Out-Null

$tgz = Join-Path $tmp $archive
Write-Host "Downloading pdfium ($url) ..."
Invoke-WebRequest -Uri $url -OutFile $tgz

Write-Host "Extracting ..."
tar -xzf $tgz -C $tmp

$dll    = Join-Path $tmp "bin\pdfium.dll"
$outDir = Join-Path $PSScriptRoot "..\src-tauri\target\debug"
New-Item -ItemType Directory -Force $outDir | Out-Null
Copy-Item $dll $outDir -Force
Write-Host "pdfium.dll -> $outDir"

$releaseDir = Join-Path $PSScriptRoot "..\src-tauri\target\release"
if (Test-Path $releaseDir) {
    Copy-Item $dll $releaseDir -Force
    Write-Host "pdfium.dll -> $releaseDir"
}

# Bundled into the Windows installer via tauri.windows.conf.json's
# `bundle.resources` ("vendor/pdfium.dll" -> ""), independent of whatever
# state target/ is in - unlike the two copies above, this one has to exist
# before Tauri's bundler runs, not just before the app is launched.
$vendorDir = Join-Path $PSScriptRoot "..\src-tauri\vendor"
New-Item -ItemType Directory -Force $vendorDir | Out-Null
Copy-Item $dll $vendorDir -Force
Write-Host "pdfium.dll -> $vendorDir"

Remove-Item $tmp -Recurse -Force
Write-Host "Done."
