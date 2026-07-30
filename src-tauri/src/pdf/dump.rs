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
}
