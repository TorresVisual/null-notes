; Trusts the shell-integration signing cert after install, so the identity
; package below registers on a fresh machine (see scripts/windows/trust-cert.ps1
; and docs/installing.md). Per-user, no admin; a failure is logged, not fatal -
; the app also reports it in its error log on first launch.
!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\trust-cert.ps1" -Action Install'
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\cli-path.ps1" -Action Add -Dir "$INSTDIR"'
!macroend

; Unregisters the NullNotes.ShellIntegration identity package (see
; src-tauri/src/commands/identity.rs) before files are removed. It's a
; sparse package added with -ExternalLocation pointing at $INSTDIR, so
; leaving it registered past uninstall would strand the "Open in
; null-notes" verb and its COM registration pointing at a deleted directory.
; Also drops the cert trust; an update re-trusts it in POSTINSTALL.
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'powershell -NoProfile -Command "Get-AppxPackage -Name NullNotes.ShellIntegration* | Remove-AppxPackage"'
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\trust-cert.ps1" -Action Uninstall'
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\cli-path.ps1" -Action Remove -Dir "$INSTDIR"'
!macroend
