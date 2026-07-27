use tauri::Window;

// The frontend owns the unsaved buffer, so closing is a two-step handshake:
// Rust vetoes the close and asks the UI to flush, the UI calls this back.
// `destroy` (not `close`) is what breaks the loop — it skips CloseRequested.
#[tauri::command]
pub fn confirm_close(window: Window) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}
