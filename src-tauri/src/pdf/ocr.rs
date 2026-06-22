use super::models::{PdfPage, TextBox};
use anyhow::{Context, Result};

pub async fn ocr_page(page: &PdfPage) -> Result<Vec<TextBox>> {
    let image_path = page.image_path.clone();

    let tmp_out = tempfile::Builder::new()
        .prefix("null-notes-ocr-")
        .tempfile()?;
    let out_base = tmp_out.path().to_string_lossy().into_owned();
    let out_txt = format!("{}.txt", out_base);
    drop(tmp_out);

    let status = tokio::process::Command::new("tesseract")
        .args([&image_path, &out_base, "-l", "eng", "--psm", "1"])
        .status()
        .await
        .context("tesseract not found — install it and ensure it is on PATH")?;

    if !status.success() {
        anyhow::bail!("tesseract exited with status {}", status);
    }

    let raw = tokio::fs::read_to_string(&out_txt).await?;
    let _ = tokio::fs::remove_file(&out_txt).await;

    let boxes = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| TextBox {
            text: line.trim().to_string(),
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 0.0,
            is_equation: false,
            latex: None,
        })
        .collect();

    Ok(boxes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires tesseract on PATH and a test fixture"]
    async fn test_ocr_returns_text() {
        let page = PdfPage {
            index: 0,
            image_path: "tests/fixtures/page-0.png".into(),
            width: 1700,
            height: 2200,
        };
        if !std::path::Path::new(&page.image_path).exists() {
            return;
        }
        let boxes = ocr_page(&page).await.unwrap();
        assert!(!boxes.is_empty());
    }
}
