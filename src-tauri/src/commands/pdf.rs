use crate::pdf::models::PdfPage;
use base64::Engine;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfImportProgress {
    page: usize,
    total_pages: usize,
}

fn pdf_dir_for(note_path: &str) -> String {
    super::sidecar_dir_for(note_path, "pdf")
}

/// Name of the search-text sidecar `import_pdf_pages` writes next to a Pages
/// note's rendered page images — see `commands::notes::pdf_search_text_for`,
/// which reads it back in at reindex time.
pub const PDF_SEARCH_TEXT_FILE: &str = "text.txt";

#[tauri::command]
pub async fn ensure_pdf_dir(note_path: String) -> Result<String, String> {
    let dir = pdf_dir_for(&note_path);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn import_pdf_pages(
    pdf_path: String,
    note_path: String,
    app: AppHandle,
) -> Result<Vec<PdfPage>, String> {
    let out_dir = pdf_dir_for(&note_path);
    tokio::fs::create_dir_all(&out_dir)
        .await
        .map_err(|e| e.to_string())?;

    let pages = crate::pdf::renderer::render_pages(
        Path::new(&pdf_path),
        Path::new(&out_dir),
        |page, total_pages| {
            let _ = app.emit("pdf://progress", PdfImportProgress { page, total_pages });
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    // Best-effort: a Pages-mode note whose text can't be extracted (e.g. a
    // genuine scan) still gets its rendered pages — it just isn't searchable
    // by content, same as before this sidecar existed.
    let pdf_path_for_text = pdf_path.clone();
    let text = tokio::task::spawn_blocking(move || {
        let pages = crate::pdf::extract::extract_pages(Path::new(&pdf_path_for_text))?;
        anyhow::Ok(crate::pdf::extract::pages_to_text(&pages))
    })
    .await
    .ok()
    .and_then(|r| r.ok());
    if let Some(text) = text {
        let _ = tokio::fs::write(Path::new(&out_dir).join(PDF_SEARCH_TEXT_FILE), text).await;
    }

    Ok(pages)
}

/// Whether a PDF carries a text layer worth converting.
///
/// Asked *before* a note is created, so a scan is caught while there is still
/// nothing to clean up — the caller offers Pages mode instead of leaving an
/// empty note behind.
#[tauri::command]
pub async fn pdf_has_text_layer(pdf_path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let pages =
            crate::pdf::extract::extract_pages(Path::new(&pdf_path)).map_err(|e| e.to_string())?;
        Ok(!pages.iter().all(|page| page.is_effectively_empty()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Converts a PDF's embedded text layer to Markdown, with embedded raster
/// images extracted alongside it (placeholder-referenced — see
/// `pdf::models::PdfMarkdownImport`). No OCR: a typeset sheet already
/// carries its own text, and reading it is exact where recognising pixels
/// would only ever be a guess.
///
/// Equations become LaTeX. The text layer holds no LaTeX, but it holds the font
/// each glyph came from and where it sits, which is enough to rebuild it — and
/// LaTeX, unlike a cropped image, can be copied into a prompt, searched, and
/// edited in place.
///
/// Writes no files and takes no note path: this runs before the note it
/// will belong to exists (see `ImportButton.tsx`, which deliberately
/// converts before creating the note so a PDF that turns out unconvertible
/// never leaves an empty note behind). The caller writes each returned
/// image via the existing `write_note_asset` once the note's path is known,
/// substituting the real path for each placeholder.
#[tauri::command]
pub async fn import_pdf_markdown(
    pdf_path: String,
) -> Result<crate::pdf::models::PdfMarkdownImport, String> {
    // pdfium is synchronous and a long sheet is real work, so it must not run
    // on the async executor.
    tokio::task::spawn_blocking(move || {
        let pages =
            crate::pdf::extract::extract_pages(Path::new(&pdf_path)).map_err(|e| e.to_string())?;

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

/// Zero-based index of the first page of a Pages-mode note whose text contains
/// `term` (case-insensitive), or `None` when it matches nowhere or the note
/// has no page-delimited search text (see `pdf::extract::pages_to_text`).
fn find_page(text: &str, term: &str) -> Option<usize> {
    if !text.contains('\u{c}') {
        return None;
    }
    let term = term.to_lowercase();
    text.split('\u{c}')
        .position(|page| page.to_lowercase().contains(&term))
}

#[tauri::command]
pub async fn find_pdf_page(note_path: String, term: String) -> Option<usize> {
    let text_path = Path::new(&pdf_dir_for(&note_path)).join(PDF_SEARCH_TEXT_FILE);
    let text = tokio::fs::read_to_string(text_path).await.ok()?;
    find_page(&text, &term)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_find_page_returns_the_first_matching_page_case_insensitively() {
        let text = "intro\u{c}Quicksort partitioning\u{c}quicksort again\u{c}";
        assert_eq!(find_page(text, "QUICKSORT"), Some(1));
        assert_eq!(find_page(text, "mergesort"), None);
    }

    #[test]
    fn test_find_page_ignores_text_without_page_boundaries() {
        assert_eq!(find_page("quicksort\n\npartitioning", "quicksort"), None);
    }

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

        let encoded = read_pdf_page(png_path.to_string_lossy().into_owned())
            .await
            .unwrap();

        assert_eq!(
            encoded,
            base64::engine::general_purpose::STANDARD.encode([1, 2, 3, 4])
        );
    }
}
