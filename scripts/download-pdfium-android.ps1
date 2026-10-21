param([string[]]$Abi = @('x86_64'))
$ErrorActionPreference = "Stop"

$release = "chromium/7763"
$asset = @{ 'x86_64' = 'pdfium-android-x64'; 'arm64-v8a' = 'pdfium-android-arm64' }

foreach ($a in $Abi) {
    if (-not $asset.ContainsKey($a)) { throw "Unknown ABI '$a' (expected: $($asset.Keys -join ', '))" }
    $archive = "$($asset[$a]).tgz"
    $tmp = Join-Path $env:TEMP "pdfium-android-$a"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $tmp | Out-Null

    $url = "https://github.com/bblanchon/pdfium-binaries/releases/download/$release/$archive"
    Write-Host "Downloading $url ..."
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp $archive)
    tar -xzf (Join-Path $tmp $archive) -C $tmp

    $so = Join-Path $tmp "lib\libpdfium.so"
    $magic = [System.IO.File]::ReadAllBytes($so)[0..3] -join ','
    if ($magic -ne '127,69,76,70') { throw "$so is not an ELF file" }

    $outDir = Join-Path $PSScriptRoot "..\src-tauri\gen\android\app\src\main\jniLibs\$a"
    New-Item -ItemType Directory -Force $outDir | Out-Null
    Copy-Item $so $outDir -Force
    Write-Host "libpdfium.so -> $outDir"
    Remove-Item $tmp -Recurse -Force
}
