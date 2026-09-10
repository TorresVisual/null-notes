<#
.SYNOPSIS
Generates (if missing) a self-signed code-signing certificate for null-notes'
Explorer shell-integration identity package, and trusts it locally.

Per docs/research/windows11-top-level-context-menu.md §5: this only works on
machines where this script (or an equivalent manual Import-Certificate step)
has been run. It is NOT a substitute for a real code-signing certificate —
anonymous downloads of null-notes will not be able to register the identity
package until public signing is added.

Subject must exactly match Identity/@Publisher in identity-package/AppxManifest.xml.
#>

$ErrorActionPreference = "Stop"

$subject = "CN=null-notes-dev"
$certDir = Join-Path $PSScriptRoot ".dev-cert"
$pfxPath = Join-Path $certDir "null-notes-dev.pfx"
$cerPath = Join-Path $certDir "null-notes-dev.cer"

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$existing = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $subject }

if (-not $existing) {
    Write-Host "Generating new self-signed certificate ($subject)..."
    $existing = New-SelfSignedCertificate `
        -Type Custom `
        -Subject $subject `
        -KeyUsage DigitalSignature `
        -FriendlyName "null-notes dev signing cert" `
        -CertStoreLocation Cert:\CurrentUser\My `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
} else {
    Write-Host "Reusing existing certificate ($subject)."
}

if (-not (Test-Path $pfxPath)) {
    $pfxPassword = ConvertTo-SecureString -String "null-notes-dev" -Force -AsPlainText
    Export-PfxCertificate -Cert $existing -FilePath $pfxPath -Password $pfxPassword | Out-Null
    Export-Certificate -Cert $existing -FilePath $cerPath | Out-Null
}

$trusted = Get-ChildItem Cert:\CurrentUser\TrustedPeople |
    Where-Object { $_.Thumbprint -eq $existing.Thumbprint }

if (-not $trusted) {
    Write-Host "Trusting certificate in Cert:\CurrentUser\TrustedPeople..."
    Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
} else {
    Write-Host "Certificate already trusted."
}

Write-Host "Done. PFX: $pfxPath (password: null-notes-dev)"
