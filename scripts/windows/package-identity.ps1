<#
.SYNOPSIS
Builds and signs the null-notes sparse identity package (identity-package/)
into identity-package/null-notes-identity.msix, using the dev cert from
scripts/windows/dev-cert.ps1. Requires the Windows SDK (MakeAppx.exe,
SignTool.exe) to be installed and on PATH, or discoverable under the usual
Program Files (x86)\Windows Kits\10\bin\<version>\x64\ location.
#>

$ErrorActionPreference = "Stop"

function Find-SdkTool($name) {
    $onPath = Get-Command $name -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $kits = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Directory |
        Sort-Object Name -Descending
    foreach ($kit in $kits) {
        $candidate = Join-Path $kit.FullName "x64\$name"
        if (Test-Path $candidate) { return $candidate }
    }
    throw "$name not found on PATH or under Windows Kits\10\bin - install the Windows SDK."
}

$makeAppx = Find-SdkTool "MakeAppx.exe"
$signTool = Find-SdkTool "SignTool.exe"

$root = Join-Path $PSScriptRoot "..\.." | Resolve-Path
$identityDir = Join-Path $root "identity-package"
$msixPath = Join-Path $identityDir "null-notes-identity.msix"
$pfxPath = Join-Path $PSScriptRoot ".dev-cert\null-notes-dev.pfx"

if (-not (Test-Path $pfxPath)) {
    throw "Dev cert not found at $pfxPath - run scripts/windows/dev-cert.ps1 first."
}

Write-Host "Packaging $identityDir -> $msixPath"
# /nv (no validation): this is a sparse package - Applications/Extensions
# reference null-notes.exe and null_notes_context_menu.dll, which live at
# the real ExternalLocation install dir, not inside identity-package/.
& $makeAppx pack /nv /d $identityDir /p $msixPath /overwrite
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed with exit code $LASTEXITCODE" }

Write-Host "Signing $msixPath"
& $signTool sign /fd SHA256 /f $pfxPath /p "null-notes-dev" $msixPath
if ($LASTEXITCODE -ne 0) { throw "SignTool failed with exit code $LASTEXITCODE" }

Write-Host "Done: $msixPath"
