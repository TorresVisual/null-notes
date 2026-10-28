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

# CI: never mint a fresh keypair - every release must be signed by the one cert
# machines already trust. null-notes-dev.cer (committed) is its public half.
if ($env:NULL_NOTES_SIGNING_PFX_BASE64) {
    [IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($env:NULL_NOTES_SIGNING_PFX_BASE64))
    $pinned = [Security.Cryptography.X509Certificates.X509Certificate2]::new($pfxPath, "null-notes-dev").Thumbprint
    $committed = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $PSScriptRoot "null-notes-dev.cer")).Thumbprint
    if ($pinned -ne $committed) {
        throw "Pinned PFX thumbprint $pinned does not match scripts/windows/null-notes-dev.cer ($committed) - update the committed .cer or the secret."
    }
    Write-Host "Using pinned signing cert $pinned."
    return
}

$existing = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $subject }

if (-not $existing) {
    Write-Host "Generating new self-signed certificate ($subject)..."
    $existing = New-SelfSignedCertificate `
        -Type Custom `
        -Subject $subject `
        -KeyUsage DigitalSignature `
        -NotAfter (Get-Date).AddYears(10) `
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

& (Join-Path $PSScriptRoot "trust-cert.ps1") -Action Install -CerPath $cerPath

Write-Host "Done. PFX: $pfxPath (password: null-notes-dev)"
