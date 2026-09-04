$ErrorActionPreference = "Stop"

npm run tauri build

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$installer = "$PSScriptRoot\src-tauri\target\release\bundle\nsis\null-notes_0.1.0_x64-setup.exe"

if (Test-Path $installer) {
    Start-Process $installer
} else {
    Write-Error "Installer not found: $installer"
    exit 1
}