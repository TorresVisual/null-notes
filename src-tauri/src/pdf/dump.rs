//! Diagnostics for inspecting a real PDF's text layer.
//!
//! The layout algorithm can only be judged against real documents. Every bug
//! found so far — pdfium's synthetic CR/LF poisoning the font-size median,
//! Computer Modern's detached accents, a raised footnote marker shifting a
//! row's baseline window — was invisible in synthetic fixtures and obvious the
//! moment a real sheet went through. Ignored by default; takes the file from
//! `NULL_NOTES_PDF`:
//!
//! ```text
//! NULL_NOTES_PDF=../notes/Sheet.pdf cargo test dump_markdown -- --ignored --nocapture
//! ```

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    fn fixture() -> Option<PathBuf> {
        let path = PathBuf::from(std::env::var("NULL_NOTES_PDF").ok()?);
        path.exists().then_some(path)
    }

    macro_rules! pdf_or_skip {
        () => {
            match fixture() {
                Some(path) => path,
                None => {
                    println!("set NULL_NOTES_PDF to a readable .pdf to run this");
                    return;
                }
            }
        };
    }

    /// What the import would actually write into the note.
    #[test]
    #[ignore]
    fn dump_markdown() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        for page in &pages {
            println!("--- page {} ---", page.index);
            println!("{}", crate::pdf::layout::chars_to_markdown(&page.chars));
        }
    }

    /// One row per reconstructed line, with the geometry it was grouped on.
    #[test]
    #[ignore]
    fn dump_lines() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        for line in crate::pdf::layout::group_lines(&pages[0].chars) {
            println!(
                "y={:8.2} x={:7.2} size={:5.2} fixed={} | {}",
                line.y,
                line.x,
                line.font_size,
                line.fixed_pitch,
                line.text()
            );
        }
    }

    /// Raw per-character metrics — the fastest way to tell a maths run from
    /// body text, and to see what pdfium is really handing over.
    #[test]
    #[ignore]
    fn dump_chars() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        for c in pages[0].chars.iter().take(200) {
            println!(
                "{:?} x={:7.2} y={:8.2} w={:5.2} size={:5.2} bold={} italic={} fixed={}",
                c.ch, c.x, c.y, c.width, c.font_size, c.bold, c.italic, c.fixed_pitch
            );
        }
    }

    /// Every maths region the conversion found, as the LaTeX it produced —
    /// without the surrounding prose, which is most of what's worth eyeballing
    /// when a document's equations come out wrong.
    #[test]
    #[ignore]
    fn dump_regions() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        for page in &pages {
            for line in crate::pdf::layout::group_lines(&page.chars) {
                for inline in &line.content {
                    if let crate::pdf::layout::Inline::Maths(latex) = inline {
                        println!("{latex}");
                    }
                }
            }
        }
    }

    /// Renders page 0 to a PNG in the OS temp dir, for comparing the actual
    /// typeset page against what the pipeline extracted. The only way to
    /// confirm the text layer is missing content rather than the layout
    /// algorithm mishandling it.
    #[test]
    #[ignore]
    fn dump_render_page0() {
        let pdf = pdf_or_skip!();
        let out = std::env::temp_dir().join("null-notes-page0.png");
        let pdfium = crate::pdf::renderer::bind_pdfium().unwrap();
        let doc = pdfium.load_pdf_from_file(&pdf, None).unwrap();
        let page = doc.pages().first().unwrap();
        use pdfium_render::prelude::PdfRenderConfig;
        let bitmap = page.render_with_config(&PdfRenderConfig::new().set_target_width(1600)).unwrap();
        let (w, h) = (bitmap.width() as u32, bitmap.height() as u32);
        let img = image::RgbaImage::from_raw(w, h, bitmap.as_rgba_bytes()).unwrap();
        img.save(&out).unwrap();
        println!("saved to {}", out.display());
    }

    /// Raw pdfium output, bypassing every filter this pipeline applies —
    /// including characters `extract.rs` would drop. Found the bug where one
    /// PDF's real body-text font reported an empty `font_name()`, which a
    /// name-based filter mistook for pdfium's own layout filler.
    #[test]
    #[ignore]
    fn dump_raw_pdfium_chars() {
        let pdf = pdf_or_skip!();
        let pdfium = crate::pdf::renderer::bind_pdfium().unwrap();
        let doc = pdfium.load_pdf_from_file(&pdf, None).unwrap();
        let page = doc.pages().first().unwrap();
        let text = page.text().unwrap();
        let chars = text.chars();
        println!("total raw chars on page: {}", chars.len());

        let mut none_unicode = 0;
        let mut empty_font = 0;
        let mut ok = 0;
        for c in chars.iter() {
            match c.unicode_char() {
                None => none_unicode += 1,
                Some(_) => {
                    if c.font_name().is_empty() {
                        empty_font += 1;
                    } else {
                        ok += 1;
                    }
                }
            }
        }
        println!("none_unicode={none_unicode} empty_font={empty_font} ok={ok}");

        for c in chars.iter().take(80) {
            println!(
                "uni={:?} font={:?} size={:.2} gen={:?}",
                c.unicode_char(),
                c.font_name(),
                c.scaled_font_size().value,
                c.is_generated().ok(),
            );
        }
    }

    #[test]
    #[ignore]
    fn dump_specific_chars() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        let all: Vec<_> = pages.iter().flat_map(|p| p.chars.iter()).collect();

        // "wird jeweils" — find "wird" then show what follows, in char space
        // throughout. A byte offset from str::find would misalign against a
        // char index once any multi-byte German character appears earlier.
        let chars: Vec<char> = all.iter().map(|c| c.ch).collect();
        let text: String = chars.iter().collect();
        if let Some(byte_idx) = text.find("wird") {
            let idx = text[..byte_idx].chars().count();
            let window: String = chars[idx..(idx + 12).min(chars.len())].iter().collect();
            println!("AROUND 'wird': {window:?}");
        }

        // The oint/contour integral symbol — first char on the page after the heading.
        println!("--- first 10 chars of first display equation on page 0 ---");
        for c in pages[0].chars.iter().skip(50).take(15) {
            println!("{:?} size={:.2} fam={:?}", c.ch, c.font_size, c.family);
        }

        // ß / ÿ
        if let Some(byte_idx) = text.find('\u{ff}') {
            let idx = text[..byte_idx].chars().count();
            let start = idx.saturating_sub(5);
            let window: String = chars[start..(idx + 5).min(chars.len())].iter().collect();
            println!("AROUND ÿ: {window:?}");
        } else {
            println!("no ÿ found in extracted text");
        }
    }

    #[test]
    #[ignore]
    fn dump_wird_geometry() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        let all: Vec<_> = pages.iter().flat_map(|p| p.chars.iter()).collect();
        let chars: Vec<char> = all.iter().map(|c| c.ch).collect();
        let text: String = chars.iter().collect();
        let byte_idx = text.find("wird").unwrap();
        let idx = text[..byte_idx].chars().count();
        for c in &all[idx.saturating_sub(2)..(idx + 14).min(all.len())] {
            println!(
                "{:?} x={:8.3} y={:8.3} w={:6.3} size={:.2} fam={:?} preceded_by_maths_family={:?}",
                c.ch, c.x, c.y, c.width, c.font_size, c.family, c.family
            );
        }
    }
}
