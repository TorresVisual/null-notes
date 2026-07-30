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

/// Whether a PDF carries a text layer worth converting.
///
/// Asked *before* a note is created, so a scan is caught while there is still
/// nothing to clean up — the caller offers Pages mode instead of leaving an
/// empty note behind.
#[tauri::command]
pub async fn pdf_has_text_layer(pdf_path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let pages = crate::pdf::extract::extract_pages(Path::new(&pdf_path))
            .map_err(|e| e.to_string())?;
        Ok(!pages.iter().all(|page| page.is_effectively_empty()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Converts a PDF's embedded text layer to Markdown. No OCR: a typeset sheet
/// already carries its own text, and reading it is exact where recognising
/// pixels would only ever be a guess.
///
/// Equations become LaTeX. The text layer holds no LaTeX, but it holds the font
/// each glyph came from and where it sits, which is enough to rebuild it — and
/// LaTeX, unlike a cropped image, can be copied into a prompt, searched, and
/// edited in place.
#[tauri::command]
pub async fn import_pdf_markdown(pdf_path: String) -> Result<String, String> {
    // pdfium is synchronous and a long sheet is real work, so it must not run
    // on the async executor.
    tokio::task::spawn_blocking(move || {
        let pages = crate::pdf::extract::extract_pages(Path::new(&pdf_path))
            .map_err(|e| e.to_string())?;

        if pages.iter().all(|page| page.is_effectively_empty()) {
            return Err(
                "This PDF has no text layer — it looks like a scan. Import it as pages instead."
                    .to_string(),
            );
        }

        Ok(crate::pdf::extract::pages_to_markdown(&pages))
    })
    .await
    .map_err(|e| e.to_string())?
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
