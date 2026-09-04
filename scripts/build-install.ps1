$ErrorActionPreference = "Stop"

Write-Host "Building null-notes..." -ForegroundColor Cyan

npm run tauri build

if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed."
    exit $LASTEXITCODE
}

$bundleDir = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\nsis"

$installer = Get-ChildItem $bundleDir -Filter "*-setup.exe" -File |
    Select-Object -First 1

if (-not $installer) {
    Write-Error "Installer not found in: $bundleDir"
    exit 1
}

Write-Host "Build complete!" -ForegroundColor Green
Write-Host "Opening: $($installer.FullName)" -ForegroundColor Green

Start-Process $installer.FullName