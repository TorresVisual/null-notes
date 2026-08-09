//! Diagnostics for inspecting a real PDF's text layer.
//!
//! The layout algorithm can only be judged against real documents. Every bug
//! found so far — pdfium's synthetic CR/LF poisoning the font-size median,
//! Computer Modern's detached accents, a raised footnote marker shifting a
//! row's baseline window, an operator name ("log", "cos") set in the same
//! upright font as prose and so indistinguishable from it by family alone,
//! a real ligature glyph pdfium can only report as a control codepoint —
//! was invisible in synthetic fixtures and obvious the moment a real sheet
//! went through. Ignored by default; takes the file from `NULL_NOTES_PDF`:
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

    /// Every line's full content vector, Text and Maths pieces both, with
    /// geometry — for seeing exactly how a row's pieces were split (or
    /// weren't) before fraction reconstruction runs.
    #[test]
    #[ignore]
    fn dump_line_pieces() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        for line in crate::pdf::layout::group_lines(&pages[0].chars) {
            println!(
                "y={:8.2} x={:7.2} right={:7.2} display_maths={} content={:?}",
                line.y, line.x, line.right, line.is_display_maths, line.content
            );
        }
    }

    /// What the import would actually write into the note.
    #[test]
    #[ignore]
    fn dump_markdown() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        let result = crate::pdf::extract::pages_to_markdown(&pages);
        println!("{}", result.markdown);
        for image in &result.images {
            println!("[image] {} ({} bytes)", image.placeholder, image.data.len());
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

    /// Raw pdfium chars (bypassing every filter `extract.rs` applies) around
    /// a search string in the page's raw text — for finding what pdfium
    /// actually reports for a glyph that vanished from the converted output,
    /// e.g. the "ff" of "Differentialgleichung" on Analysis_2_Blatt12.pdf.
    #[test]
    #[ignore]
    fn dump_raw_chars_near() {
        let needle = std::env::var("NULL_NOTES_NEEDLE").unwrap_or_else(|_| "Di".into());
        let pdf = pdf_or_skip!();
        let pdfium = crate::pdf::renderer::bind_pdfium().unwrap();
        let doc = pdfium.load_pdf_from_file(&pdf, None).unwrap();
        for (page_index, page) in doc.pages().iter().enumerate() {
            let text = page.text().unwrap();
            let chars = text.chars();
            let raw: Vec<_> = chars.iter().collect();
            let joined: String = raw.iter().map(|c| c.unicode_char().unwrap_or('\u{FFFD}')).collect();
            let mut search_from = 0;
            while let Some(byte_idx) = joined[search_from..].find(&needle) {
                let idx = joined[..search_from + byte_idx].chars().count();
                println!("--- page {page_index}, {needle:?} at raw index {idx} ---");
                let lo = idx.saturating_sub(2);
                let hi = (idx + needle.chars().count() + 6).min(raw.len());
                for (j, c) in raw[lo..hi].iter().enumerate() {
                    println!(
                        "  [{}] uni={:?} font={:?} size={:.2} gen={:?} hyphen={:?}",
                        lo + j,
                        c.unicode_char(),
                        c.font_name(),
                        c.scaled_font_size().value,
                        c.is_generated().ok(),
                        c.is_hyphen().ok(),
                    );
                }
                search_from = search_from + byte_idx + needle.len();
            }
        }
    }

    /// Every control character pdfium hands back at a real (non-filler) font
    /// size, grouped by codepoint, with one example of surrounding text per
    /// codepoint. `extract.rs` currently drops all of these via
    /// `value.is_control()` — this is to check whether that is safe to
    /// narrow, i.e. whether a real-sized control codepoint is always a
    /// mis-encoded ligature (safe to keep) or sometimes something else
    /// (unsafe to keep blindly).
    #[test]
    #[ignore]
    fn dump_real_sized_control_chars() {
        use std::collections::BTreeMap;
        let pdf = pdf_or_skip!();
        let pdfium = crate::pdf::renderer::bind_pdfium().unwrap();
        let doc = pdfium.load_pdf_from_file(&pdf, None).unwrap();
        let mut examples: BTreeMap<u32, String> = BTreeMap::new();
        for page in doc.pages().iter() {
            let text = page.text().unwrap();
            let chars = text.chars();
            let raw: Vec<_> = chars.iter().collect();
            for (i, c) in raw.iter().enumerate() {
                let Some(value) = c.unicode_char() else { continue };
                if value.is_control() && c.scaled_font_size().value > 1.5 {
                    examples.entry(value as u32).or_insert_with(|| {
                        let lo = i.saturating_sub(3);
                        let hi = (i + 4).min(raw.len());
                        raw[lo..hi]
                            .iter()
                            .map(|c| c.unicode_char().unwrap_or('\u{FFFD}'))
                            .collect()
                    });
                }
            }
        }
        for (codepoint, context) in &examples {
            println!("U+{codepoint:04X} in context {context:?}");
        }
        println!("{} distinct real-sized control codepoints", examples.len());
    }

    /// `text.all()` goes through `FPDFText_GetBoundedText`, a different
    /// pdfium API than the per-character `unicode_char()` path `extract.rs`
    /// uses. Checking whether it resolves the ligatures that vanish through
    /// the per-char path — if pdfium's own bounded-text extraction already
    /// expands them, that is a real signal to build on, not a guess.
    #[test]
    #[ignore]
    fn dump_bounded_text_ligatures() {
        let pdf = pdf_or_skip!();
        let pdfium = crate::pdf::renderer::bind_pdfium().unwrap();
        let doc = pdfium.load_pdf_from_file(&pdf, None).unwrap();
        let page = doc.pages().first().unwrap();
        let text = page.text().unwrap();
        let all = text.all();
        for needle in ["Differential", "trifft", "getroffen", "Koeffizient", "Klassifizieren"] {
            match all.find(needle) {
                Some(idx) => {
                    let window = &all[idx.saturating_sub(5)..(idx + needle.len() + 10).min(all.len())];
                    println!("FOUND {needle:?} -> {window:?}");
                }
                None => println!("NOT FOUND: {needle:?}"),
            }
        }
        for needle in ["erential", "tro", "getro", "Koe", "Klassi"] {
            if let Some(idx) = all.find(needle) {
                let chars: Vec<char> = all.chars().collect();
                let byte_idx = idx;
                let char_idx = all[..byte_idx].chars().count();
                let lo = char_idx.saturating_sub(5);
                let hi = (char_idx + needle.chars().count() + 5).min(chars.len());
                let window: String = chars[lo..hi].iter().collect();
                println!("near {needle:?}: {window:?} (codepoints: {:?})", chars[lo..hi].iter().map(|c| *c as u32).collect::<Vec<_>>());
            }
        }
    }

    /// Raw geometry around a search string in the *extracted* (filtered)
    /// text, one row per character — for diagnosing why a maths region did
    /// or didn't absorb a nearby word, where `dump_chars`'s fixed
    /// first-200-characters window doesn't reach.
    #[test]
    #[ignore]
    fn dump_chars_near() {
        let needle = std::env::var("NULL_NOTES_NEEDLE").unwrap_or_else(|_| "log".into());
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        for (page_index, page) in pages.iter().enumerate() {
            let text: String = page.chars.iter().map(|c| c.ch).collect();
            let mut search_from = 0;
            while let Some(byte_idx) = text[search_from..].find(&needle) {
                let idx = text[..search_from + byte_idx].chars().count();
                println!("--- page {page_index}, {needle:?} at index {idx} ---");
                let lo = idx.saturating_sub(8);
                let hi = (idx + needle.chars().count() + 8).min(page.chars.len());
                for (j, c) in page.chars[lo..hi].iter().enumerate() {
                    println!(
                        "  [{}] {:?} x={:8.3} w={:6.3} size={:5.2} fam={:?} alpha={}",
                        lo + j,
                        c.ch,
                        c.x,
                        c.width,
                        c.font_size,
                        c.family,
                        c.ch.is_alphabetic(),
                    );
                }
                search_from = search_from + byte_idx + needle.len();
            }
        }
    }

    /// Widths of the control-codepoint glyphs found on Analysis_2_Blatt12.pdf
    /// against real, independently-decoded single letters in the same
    /// document/font/size — checking whether ligature length (2 vs 3
    /// letters) is distinguishable by width alone, before trusting a
    /// reconstruction built on it. Raw pdfium chars, not the filtered/FFFD
    /// output, so the original codepoint (which ligature) is still visible.
    #[test]
    #[ignore]
    fn dump_ligature_widths() {
        let pdf = pdf_or_skip!();
        let pdfium = crate::pdf::renderer::bind_pdfium().unwrap();
        let doc = pdfium.load_pdf_from_file(&pdf, None).unwrap();
        let mut single_letter_widths: std::collections::BTreeMap<char, f32> = Default::default();
        let mut control_widths: Vec<(u32, f32, f32)> = Vec::new();
        for page in doc.pages().iter() {
            let text = page.text().unwrap();
            for c in text.chars().iter() {
                let Some(value) = c.unicode_char() else { continue };
                let Ok(bounds) = c.loose_bounds() else { continue };
                let size = c.scaled_font_size().value;
                if matches!(value, 'f' | 'i' | 'l' | 'o' | 'e' | 'r' | 'n' | 't')
                    && (size - 11.96).abs() < 0.1
                {
                    single_letter_widths.entry(value).or_insert(bounds.width().value);
                }
                if value.is_control() && size > 1.5 {
                    control_widths.push((value as u32, bounds.width().value, size));
                }
            }
        }
        println!("single-letter widths at 11.96pt: {single_letter_widths:?}");
        println!("control-char widths (codepoint, width, size): {control_widths:?}");
    }

    #[test]
    #[ignore]
    fn dump_chars_range() {
        let lo: usize = std::env::var("NULL_NOTES_LO").ok().and_then(|s| s.parse().ok()).unwrap_or(0);
        let hi: usize = std::env::var("NULL_NOTES_HI").ok().and_then(|s| s.parse().ok()).unwrap_or(50);
        let page_index: usize = std::env::var("NULL_NOTES_PAGE").ok().and_then(|s| s.parse().ok()).unwrap_or(0);
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        let page = &pages[page_index];
        for (i, c) in page.chars.iter().enumerate().skip(lo).take(hi - lo) {
            println!(
                "[{i}] {:?} x={:8.3} y={:8.3} w={:6.3} size={:5.2} fam={:?}",
                c.ch, c.x, c.y, c.width, c.font_size, c.family
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

    /// Where does the diaeresis for "für" sit in the extraction stream,
    /// relative to the "u" it belongs over? `combining_form` in `layout.rs`
    /// assumes it is the very next character after its base letter — true on
    /// the first document tested, apparently not on this one, where the
    /// accent lands at the very end of the line's rendered text instead.
    #[test]
    #[ignore]
    fn dump_accent_stream_position() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        let chars = &pages[0].chars;
        for (i, c) in chars.iter().enumerate() {
            if c.ch == '\u{00A8}' {
                println!(
                    "accent U+00A8 at stream index {i} x={:.2} y={:.2}",
                    c.x, c.y
                );
                let lo = i.saturating_sub(6);
                let hi = (i + 6).min(chars.len());
                for (j, near) in chars[lo..hi].iter().enumerate() {
                    println!(
                        "  [{}] {:?} x={:.2} y={:.2}",
                        lo + j,
                        near.ch,
                        near.x,
                        near.y
                    );
                }
            }
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

    /// Column-region boundaries for the page, and the y-range / left-x of the
    /// lines each region resolves to once regrouped independently — the
    /// per-region pipeline (`pages_to_markdown`) processes each of these in
    /// isolation, which can produce a different depth/marker reading than
    /// grouping the whole page's lines together (`dump_lines`) would.
    #[test]
    #[ignore]
    fn dump_regions_geometry() {
        let pages = crate::pdf::extract::extract_pages(&pdf_or_skip!()).unwrap();
        let regions = crate::pdf::columns::segment_regions(&pages[0].chars);
        println!("{} region(s)", regions.len());
        for (i, region) in regions.iter().enumerate() {
            let (x0, x1) = crate::pdf::layout::row_x_extent(region);
            println!("--- region {i}: x=[{x0:.2}, {x1:.2}], {} chars ---", region.len());
            for line in crate::pdf::layout::group_lines(region) {
                println!(
                    "  y={:8.2} x={:7.2} size={:5.2} | {}",
                    line.y, line.x, line.font_size, line.text()
                );
            }
        }
    }
}
