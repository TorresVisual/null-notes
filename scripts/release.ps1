$ErrorActionPreference = "Stop"

node scripts/release-tui.mjs

if ($LASTEXITCODE -ne 0) {
    Write-Error "Release failed."
    exit $LASTEXITCODE
}
