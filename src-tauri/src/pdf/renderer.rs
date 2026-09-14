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
        anyhow::bail!(
            "PDF rendering requires the pdf-native feature: {:?}",
            pdf_path
        )
    }
}

// pdfium-render is a pure binding crate — the actual pdfium binary is a
// separate download that has to sit somewhere findable at runtime. The
// current working directory (what "./" resolves against) is reliable for
// `cargo run`/`tauri dev` but not guaranteed for however a packaged build
// gets launched, so this also tries next to the running executable before
// falling back to whatever the OS considers a system library.
#[cfg(feature = "pdf-native")]
pub fn bind_pdfium() -> Result<pdfium_render::prelude::Pdfium> {
    use pdfium_render::prelude::{Pdfium, PdfiumError};

    let exe_dir_candidate = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    let attempt = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
        .or_else(|e| match e {
            // Not a failure. pdfium initialises its bindings once per process,
            // and a second bind reports this rather than handing them back —
            // which any import doing more than one pdfium pass will hit, as
            // converting a sheet does (extract the text, then render to crop
            // the equations). Propagating it as an error made every such import
            // fail with a bogus "pdfium not found".
            PdfiumError::PdfiumLibraryBindingsAlreadyInitialized => Err(e),
            _ => {
                // iOS bundles `bundle.resources` entries into a fixed `assets/`
                // subdirectory next to the executable, not the executable's own
                // directory (confirmed empirically: docs/plans/mobile-pdfium-ios-spike.md
                // Task 1) — desktop's lookup order below is unaffected.
                #[cfg(target_os = "ios")]
                if let Some(dir) = &exe_dir_candidate {
                    if let Ok(b) = Pdfium::bind_to_library(
                        Pdfium::pdfium_platform_library_name_at_path(dir.join("assets")),
                    ) {
                        return Ok(b);
                    }
                }
                exe_dir_candidate
                    .map(|dir| {
                        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&dir))
                    })
                    .unwrap_or_else(Pdfium::bind_to_system_library)
                    .or_else(|_| Pdfium::bind_to_system_library())
            }
        });

    match attempt {
        Ok(bindings) => Ok(Pdfium::new(bindings)),
        // Pdfium::default() is the crate's own route to reusing bindings that
        // are already live; it does not touch the filesystem in this case.
        Err(PdfiumError::PdfiumLibraryBindingsAlreadyInitialized) => Ok(Pdfium::default()),
        Err(e) => Err(anyhow::anyhow!(
            "pdfium ({}) not found — download a prebuilt release for this platform from \
             https://github.com/bblanchon/pdfium-binaries and place it next to null-notes.exe \
             (original error: {e})",
            Pdfium::pdfium_platform_library_name().to_string_lossy(),
        )),
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
    use pdfium_render::prelude::PdfRenderConfig;

    let pdfium = bind_pdfium()?;

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

        // Building the PNG from raw RGBA bytes through our own `image` crate
        // rather than `bitmap.as_image()` sidesteps pdfium-render's internal,
        // separately-versioned `image` dependency, whose PNG encoder isn't
        // compiled in by default (fails at runtime: "format Png is not
        // supported" — a build-time-invisible mismatch, not a code bug here).
        let (width, height) = (bitmap.width() as u32, bitmap.height() as u32);
        let rgba = bitmap.as_rgba_bytes();
        let img = image::RgbaImage::from_raw(width, height, rgba).ok_or_else(|| {
            anyhow::anyhow!("rendered page {index} had a mismatched pixel buffer size")
        })?;

        let img_path = out_dir.join(format!("page-{index}.png"));
        img.save(&img_path)?;

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

    #[test]
    #[ignore = "requires pdfium native library"]
    fn test_bind_pdfium_finds_the_native_library() {
        bind_pdfium().unwrap();
    }

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
