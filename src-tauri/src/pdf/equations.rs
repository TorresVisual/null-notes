use anyhow::{Context, Result};
use std::path::Path;

pub async fn extract_latex(
    image_path: &str,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    venv_path: &Path,
) -> Result<String> {
    let crop_path = crop_region(image_path, x, y, w, h)?;

    #[cfg(unix)]
    let python = venv_path.join("bin/python");
    #[cfg(windows)]
    let python = venv_path.join("Scripts/python.exe");

    let output = tokio::process::Command::new(&python)
        .args(["-m", "pix2tex.cli", "--", &crop_path])
        .output()
        .await
        .context("failed to run pix2tex")?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("pix2tex failed: {}", err);
    }

    Ok(String::from_utf8(output.stdout)?.trim().to_string())
}

fn crop_region(image_path: &str, x: u32, y: u32, w: u32, h: u32) -> Result<String> {
    use image::GenericImageView;

    let img = image::open(image_path)?;
    let (img_w, img_h) = img.dimensions();
    let bx = x.min(img_w.saturating_sub(1));
    let by = y.min(img_h.saturating_sub(1));
    let bw = w.min(img_w - bx);
    let bh = h.min(img_h - by);
    let cropped = img.crop_imm(bx, by, bw, bh);

    let tmp = tempfile::Builder::new().suffix(".png").tempfile()?;
    let path = tmp.path().to_string_lossy().into_owned();
    cropped.save(&path)?;
    std::mem::forget(tmp);
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires pix2tex venv at src-tauri/pix2tex-venv"]
    async fn test_extract_returns_latex() {
        let venv = std::path::PathBuf::from("pix2tex-venv");
        if !venv.exists() {
            return;
        }
        let result = extract_latex("tests/fixtures/equation.png", 0, 0, 200, 50, &venv).await;
        assert!(result.is_ok());
    }
}
