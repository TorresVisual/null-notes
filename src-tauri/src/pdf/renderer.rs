use super::models::PdfPage as PageRecord;
use anyhow::Result;
use std::path::Path;

pub async fn render_pages(pdf_path: &Path) -> Result<Vec<PageRecord>> {
    #[cfg(feature = "pdf-native")]
    {
        render_pages_native(pdf_path).await
    }
    #[cfg(not(feature = "pdf-native"))]
    {
        anyhow::bail!("PDF rendering requires the pdf-native feature: {:?}", pdf_path)
    }
}

#[cfg(feature = "pdf-native")]
async fn render_pages_native(pdf_path: &Path) -> Result<Vec<PageRecord>> {
    use pdfium_render::prelude::{
        Pdfium, PdfRenderConfig,
    };

    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
            .or_else(|_| Pdfium::bind_to_system_library())?,
    );

    let doc = pdfium.load_pdf_from_file(pdf_path, None)?;
    let tmp_dir = tempfile::tempdir()?;
    let mut records = Vec::new();

    for (index, page) in doc.pages().iter().enumerate() {
        let bitmap = page.render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(1700)
                .set_maximum_height(2200),
        )?;

        let img_path = tmp_dir.path().join(format!("page-{}.png", index));
        bitmap.as_image()?.save(&img_path)?;

        let (width, height) = (bitmap.width() as u32, bitmap.height() as u32);
        records.push(PageRecord {
            index,
            image_path: img_path.to_string_lossy().into_owned(),
            width,
            height,
        });
    }

    std::mem::forget(tmp_dir);
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
        let pages = render_pages(&pdf).await.unwrap();
        assert!(!pages.is_empty());
    }
}
