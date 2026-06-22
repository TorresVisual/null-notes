#!/usr/bin/env bash
set -e
VENV="src-tauri/pix2tex-venv"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip
"$VENV/bin/pip" install pix2tex[gui]
echo "pix2tex venv ready at $VENV"
