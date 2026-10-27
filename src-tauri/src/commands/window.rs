use tauri::Window;

// The frontend owns the unsaved buffer, so closing is a two-step handshake:
// Rust vetoes the close and asks the UI to flush, the UI calls this back.
// `destroy` (not `close`) is what breaks the loop — it skips CloseRequested.
#[tauri::command]
pub fn confirm_close(window: Window) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}

// Android's window.close() does not finish the activity, so system Back at the
// root has to end the process itself.
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0)
}

// Debug builds include the e2e binary (`tauri build --debug`), which must not
// reach the network or raise an update dialog, so the startup update check is
// gated on this rather than on the frontend's own build mode.
#[tauri::command]
pub fn is_release_build() -> bool {
    !cfg!(debug_assertions)
}
