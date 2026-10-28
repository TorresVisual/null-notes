<#
.SYNOPSIS
Trusts (Install) or untrusts (Uninstall) null-notes' shell-integration signing
certificate for the current user - no admin needed.

Run by the NSIS installer hooks (src-tauri/windows/hooks.nsh) and by
dev-cert.ps1; also safe to run by hand from the install folder. The .cer is the
public half of the single pinned cert that release builds are signed with
(see docs/installing.md), so one trust step covers every release.
#>
param(
    [Parameter(Mandatory)][ValidateSet("Install", "Uninstall")][string]$Action,
    [string]$CerPath = (Join-Path $PSScriptRoot "null-notes-dev.cer")
)

$ErrorActionPreference = "Stop"

$store = "Cert:\CurrentUser\TrustedPeople"
$thumbprint = [Security.Cryptography.X509Certificates.X509Certificate2]::new($CerPath).Thumbprint

if ($Action -eq "Install") {
    if (Test-Path "$store\$thumbprint") {
        Write-Host "Certificate $thumbprint already trusted."
    } else {
        Import-Certificate -FilePath $CerPath -CertStoreLocation $store | Out-Null
        Write-Host "Trusted certificate $thumbprint in $store."
    }
} else {
    Remove-Item "$store\$thumbprint" -ErrorAction SilentlyContinue
    Write-Host "Removed certificate $thumbprint from $store."
}
