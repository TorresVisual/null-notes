use super::models::{PdfPage, TextBox};
use anyhow::Result;

pub async fn ocr_page(page: &PdfPage) -> Result<Vec<TextBox>> {
    #[cfg(feature = "pdf-native")]
    {
        ocr_page_native(page).await
    }
    #[cfg(not(feature = "pdf-native"))]
    {
        let _ = page;
        anyhow::bail!("OCR requires the pdf-native feature (Tesseract)")
    }
}

#[cfg(feature = "pdf-native")]
async fn ocr_page_native(page: &PdfPage) -> Result<Vec<TextBox>> {
    use leptess::LepTess;
    use std::path::Path;

    let image_path = page.image_path.clone();
    let page_width = page.width as f32;
    let page_height = page.height as f32;

    tokio::task::spawn_blocking(move || {
        let mut lt = LepTess::new(None, "eng")?;
        lt.set_image(Path::new(&image_path))?;

        let words = lt.get_component_images(leptess::capi::TessPageIteratorLevel_RIL_WORD, true)?;
        let mut boxes = Vec::new();

        for (_, bbox, _, _) in words {
            let text = lt.get_utf8_text().unwrap_or_default().trim().to_string();
            if text.is_empty() {
                continue;
            }
            boxes.push(TextBox {
                text,
                x: bbox.x as f32 / page_width,
                y: bbox.y as f32 / page_height,
                w: bbox.w as f32 / page_width,
                h: bbox.h as f32 / page_height,
                is_equation: false,
                latex: None,
            });
        }
        Ok(boxes)
    })
    .await?
}
