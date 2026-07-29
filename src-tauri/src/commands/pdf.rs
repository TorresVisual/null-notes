use base64::Engine;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use crate::pdf::models::PdfPage;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfImportProgress {
    page: usize,
    total_pages: usize,
}

fn pdf_dir_for(note_path: &str) -> String {
    let p = Path::new(note_path);
    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
    let dir = p.parent().unwrap_or(Path::new("."));
    dir.join(format!("{stem}.pdf")).to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn ensure_pdf_dir(note_path: String) -> Result<String, String> {
    let dir = pdf_dir_for(&note_path);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn import_pdf_pages(
    pdf_path: String,
    note_path: String,
    app: AppHandle,
) -> Result<Vec<PdfPage>, String> {
    let out_dir = pdf_dir_for(&note_path);
    tokio::fs::create_dir_all(&out_dir).await.map_err(|e| e.to_string())?;

    crate::pdf::renderer::render_pages(
        Path::new(&pdf_path),
        Path::new(&out_dir),
        |page, total_pages| {
            let _ = app.emit("pdf://progress", PdfImportProgress { page, total_pages });
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_pdf_page(path: String) -> Result<String, String> {
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_pdf_dir_for() {
        let dir = pdf_dir_for("/ws/Lecture 7.md");
        assert!(dir.ends_with("Lecture 7.pdf"));
    }

    #[tokio::test]
    async fn test_ensure_pdf_dir_creates_directory() {
        let tmp = tempdir().unwrap();
        let note_path = tmp.path().join("Note.md").to_string_lossy().into_owned();
        let dir = ensure_pdf_dir(note_path).await.unwrap();
        assert!(std::path::Path::new(&dir).is_dir());
    }

    #[tokio::test]
    async fn test_read_pdf_page_returns_base64() {
        let tmp = tempdir().unwrap();
        let png_path = tmp.path().join("page-0.png");
        std::fs::write(&png_path, [1, 2, 3, 4]).unwrap();

        let encoded = read_pdf_page(png_path.to_string_lossy().into_owned()).await.unwrap();

        assert_eq!(encoded, base64::engine::general_purpose::STANDARD.encode([1, 2, 3, 4]));
    }
}
