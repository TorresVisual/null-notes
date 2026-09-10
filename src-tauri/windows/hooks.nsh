; Unregisters the NullNotes.ShellIntegration identity package (see
; src-tauri/src/commands/identity.rs) before files are removed. It's a
; sparse package added with -ExternalLocation pointing at $INSTDIR, so
; leaving it registered past uninstall would strand the "Open in
; null-notes" verb and its COM registration pointing at a deleted directory.
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'powershell -NoProfile -Command "Get-AppxPackage -Name NullNotes.ShellIntegration* | Remove-AppxPackage"'
!macroend
