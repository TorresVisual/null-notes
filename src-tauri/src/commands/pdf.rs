use tauri::{AppHandle, Emitter};
use crate::pdf::models::ImportResult;

fn venv_path() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("pix2tex-venv")))
        .unwrap_or_else(|| std::path::PathBuf::from("src-tauri/pix2tex-venv"))
}

#[tauri::command]
pub async fn import_pdf(
    pdf_path: String,
    app: AppHandle,
) -> Result<ImportResult, String> {
    let path = std::path::PathBuf::from(&pdf_path);
    let venv = venv_path();

    crate::pdf::run(&path, &venv, |progress| {
        let _ = app.emit("pdf://progress", &progress);
    })
    .await
    .map_err(|e| e.to_string())
}
