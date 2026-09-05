$ErrorActionPreference = "Stop"

Write-Host "Building null-notes... [DEBUG]" -ForegroundColor Cyan

npm run tauri build -- --debug

if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed."
    exit $LASTEXITCODE
}

$debugexe = Join-Path $PSScriptRoot "..\src-tauri\target\debug\null-notes.exe"

if (-not $debugexe) {
    Write-Error "Executable not found in: $debugexe"
    exit 1
}

Write-Host "Build complete!" -ForegroundColor Green
Write-Host "Opening: $($debugexe)" -ForegroundColor Green

Start-Process $debugexe