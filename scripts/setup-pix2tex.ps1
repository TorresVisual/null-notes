$ErrorActionPreference = "Stop"
$venv = Join-Path $PSScriptRoot "..\src-tauri\pix2tex-venv"

Write-Host "Creating pix2tex venv at $venv ..."
py -3 -m venv $venv

Write-Host "Installing pix2tex ..."
& "$venv\Scripts\pip.exe" install --upgrade pip
& "$venv\Scripts\pip.exe" install "pix2tex[gui]"

Write-Host "pix2tex venv ready at $venv"
