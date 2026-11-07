//! Golden-file regression check for the frozen PDF pipeline.
//!
//! The corpus PDFs are not committed (they are coursework, and `/notes/` is
//! gitignored), but the Markdown they must convert to is, in
//! `src-tauri/tests/pdf_golden/`. With `NULL_NOTES_PDF_DIR` unset the test
//! does nothing, so CI (no pdfium, no corpus) stays green:
//!
//! ```text
//! NULL_NOTES_PDF_DIR=../notes/exercise_sheets cargo test pdf_corpus_matches_golden -- --nocapture
//! NULL_NOTES_PDF_UPDATE=1 NULL_NOTES_PDF_DIR=... cargo test pdf_corpus_matches_golden   # accept new output
//! ```
//!
//! A diff here is a decision, not noise: the pipeline is frozen, so either
//! the change is a deliberate fix (regenerate and review the golden diff in
//! the same commit) or it is a regression.

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    fn golden_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/pdf_golden")
    }

    fn normalise(text: &str) -> String {
        text.replace("\r\n", "\n")
    }

    #[test]
    fn pdf_corpus_matches_golden() {
        let Ok(dir) = std::env::var("NULL_NOTES_PDF_DIR") else {
            println!("set NULL_NOTES_PDF_DIR to a folder of .pdf files to run this");
            return;
        };
        let update = std::env::var("NULL_NOTES_PDF_UPDATE").is_ok();

        let mut pdfs: Vec<PathBuf> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| Some(entry.ok()?.path()))
            .filter(|path| path.extension().is_some_and(|ext| ext == "pdf"))
            .collect();
        pdfs.sort();
        assert!(!pdfs.is_empty(), "no .pdf files in {dir}");

        let mut failures = Vec::new();
        for pdf in &pdfs {
            let Some(stem) = pdf.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let golden = golden_dir().join(format!("{stem}.md"));
            let pages = crate::pdf::extract::extract_pages(pdf).unwrap();
            let actual = normalise(&crate::pdf::extract::pages_to_markdown(&pages).markdown);

            if update {
                std::fs::create_dir_all(golden_dir()).unwrap();
                std::fs::write(&golden, &actual).unwrap();
                continue;
            }
            match std::fs::read_to_string(&golden) {
                Ok(expected) if normalise(&expected) == actual => {}
                Ok(expected) => {
                    let line = normalise(&expected)
                        .lines()
                        .zip(actual.lines())
                        .position(|(e, a)| e != a)
                        .map_or_else(|| "length".to_string(), |i| format!("line {}", i + 1));
                    failures.push(format!("{stem}: differs from golden at {line}"));
                }
                Err(_) => failures.push(format!("{stem}: no golden file at {}", golden.display())),
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}
