<#
.SYNOPSIS
Adds (Add) or removes (Remove) a folder on the current user's PATH - no admin
needed - so `nullnotes` runs from any new terminal.

Run by the NSIS installer hooks (src-tauri/windows/hooks.nsh) with the install
folder; also safe to run by hand from it. Idempotent in both directions.
#>
param(
    [Parameter(Mandatory)][ValidateSet("Add", "Remove")][string]$Action,
    [Parameter(Mandatory)][string]$Dir
)

$ErrorActionPreference = "Stop"

$dir = $Dir.TrimEnd("\")
$current = [Environment]::GetEnvironmentVariable("Path", "User")
$others = @($current -split ";" | Where-Object { $_ -and ($_.TrimEnd("\") -ne $dir) })

$updated = if ($Action -eq "Add") { $others + $dir } else { $others }
[Environment]::SetEnvironmentVariable("Path", ($updated -join ";"), "User")
Write-Host "$Action $dir on the user PATH."
