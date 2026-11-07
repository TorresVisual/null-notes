$ErrorActionPreference = "Stop"

$bump = Read-Host "Release bump (patch/minor/major/retag) [patch]"
if (-not $bump) { $bump = "patch" }

if ($bump -notin @("patch", "minor", "major", "retag")) {
    Write-Error "Invalid bump type: $bump"
    exit 1
}

$skip = Read-Host "Targets to skip (comma-separated from windows,linux,android,ios) [none]"
$extra = @()
if ($skip) { $extra = @("--skip", $skip) }

Write-Host "Releasing ($bump)..." -ForegroundColor Cyan

npm run release -- $bump @extra

if ($LASTEXITCODE -ne 0) {
    Write-Error "Release failed."
    exit $LASTEXITCODE
}

Write-Host "Release pushed." -ForegroundColor Green
