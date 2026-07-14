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

Remove-Item $tmp -Recurse -Force
Write-Host "Done."
