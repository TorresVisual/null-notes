use super::models::PdfPage;
use anyhow::Result;
use std::path::Path;

pub async fn render_pages(
    pdf_path: &Path,
    out_dir: &Path,
    progress: impl Fn(usize, usize),
) -> Result<Vec<PdfPage>> {
    #[cfg(feature = "pdf-native")]
    {
        render_pages_native(pdf_path, out_dir, progress).await
    }
    #[cfg(not(feature = "pdf-native"))]
    {
        let _ = (out_dir, progress);
        anyhow::bail!("PDF rendering requires the pdf-native feature: {:?}", pdf_path)
    }
}

// Pages render straight into the note's sidecar directory rather than a temp
// dir — a note's PDF pages are meant to persist alongside it like ink
// sketches do, not vanish with the next reboot.
#[cfg(feature = "pdf-native")]
async fn render_pages_native(
    pdf_path: &Path,
    out_dir: &Path,
    progress: impl Fn(usize, usize),
) -> Result<Vec<PdfPage>> {
    use pdfium_render::prelude::{Pdfium, PdfRenderConfig};

    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
            .or_else(|_| Pdfium::bind_to_system_library())?,
    );

    let doc = pdfium.load_pdf_from_file(pdf_path, None)?;
    let total = doc.pages().len() as usize;
    let mut records = Vec::new();

    for (index, page) in doc.pages().iter().enumerate() {
        progress(index + 1, total);

        let bitmap = page.render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(1700)
                .set_maximum_height(2200),
        )?;

        let img_path = out_dir.join(format!("page-{index}.png"));
        bitmap.as_image()?.save(&img_path)?;

        let (width, height) = (bitmap.width() as u32, bitmap.height() as u32);
        records.push(PdfPage {
            index,
            path: img_path.to_string_lossy().into_owned(),
            width,
            height,
        });
    }

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires pdfium native library and test fixture"]
    async fn test_render_returns_pages() {
        let pdf = std::path::PathBuf::from("tests/fixtures/sample.pdf");
        if !pdf.exists() {
            return;
        }
        let out = tempfile::tempdir().unwrap();
        let pages = render_pages(&pdf, out.path(), |_, _| {}).await.unwrap();
        assert!(!pages.is_empty());
    }
}
