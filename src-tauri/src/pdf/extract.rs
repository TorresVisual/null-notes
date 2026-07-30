//! Pulls the character geometry out of a PDF's text layer.
//!
//! Kept deliberately thin: everything it does is translate pdfium's types into
//! the plain [`CharBox`](super::layout::CharBox) values that
//! [`layout`](super::layout) reasons about. All the judgement lives there,
//! where it can be tested without the native library.

use super::layout::{self, CharBox};
use anyhow::Result;
use std::path::Path;

/// How much of a page's area must carry text before it is worth converting.
/// Below this the page is a scan — an image with, at most, a stray label — and
/// P4-2 routes it to Pages mode rather than producing a garbled note.
pub const MIN_CHARS_PER_PAGE: usize = 20;

#[derive(Debug, Clone)]
pub struct ExtractedPage {
    pub index: usize,
    pub chars: Vec<CharBox>,
}

impl ExtractedPage {
    pub fn is_effectively_empty(&self) -> bool {
        self.chars
            .iter()
            .filter(|c| !c.ch.is_whitespace())
            .take(MIN_CHARS_PER_PAGE)
            .count()
            < MIN_CHARS_PER_PAGE
    }
}

/// Renders every page's text layer to Markdown, one document.
pub fn pages_to_markdown(pages: &[ExtractedPage]) -> String {
    let mut chunks: Vec<String> = Vec::new();
    for page in pages {
        let markdown = layout::chars_to_markdown(&page.chars);
        if !markdown.trim().is_empty() {
            chunks.push(markdown.trim_end().to_string());
        }
    }
    let mut out = chunks.join("\n\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

/// Equations are cropped from a render at this multiple of the PDF's own point
/// size. A page rendered 1:1 gives 72 DPI, which makes a fraction bar mush.
const MATHS_RENDER_SCALE: f32 = 3.0;

/// Converts a document to Markdown, cropping every maths region out of the
/// rendered pages into `assets_dir` and referencing it from the note.
///
/// `asset_prefix` is the note-relative directory the Markdown should point at,
/// so the links stay portable when the workspace moves.
pub fn document_to_markdown(
    pdf_path: &Path,
    pages: &[ExtractedPage],
    assets_dir: &Path,
    asset_prefix: &str,
) -> Result<String> {
    // Structure first, so the crops can be done in one pdfium pass rather than
    // re-opening the document per page.
    let per_page: Vec<(usize, Vec<layout::Block>)> = pages
        .iter()
        .map(|page| {
            (
                page.index,
                layout::group_blocks(&layout::group_lines(&page.chars)),
            )
        })
        .collect();

    let wanted: Vec<(usize, Vec<layout::Rect>)> = per_page
        .iter()
        .map(|(index, blocks)| (*index, layout::maths_rects(blocks)))
        .filter(|(_, rects)| !rects.is_empty())
        .collect();

    let mut names = if wanted.is_empty() {
        std::collections::HashMap::new()
    } else {
        std::fs::create_dir_all(assets_dir)?;
        crop_regions(pdf_path, &wanted, assets_dir)?
    };

    let mut chunks: Vec<String> = Vec::new();
    for (index, blocks) in &per_page {
        // blocks_to_markdown asks for regions in the same order maths_rects
        // returned them, so the crops line up by position.
        let mut queue = names.remove(index).unwrap_or_default().into_iter();
        let markdown = layout::blocks_to_markdown(blocks, &mut |_| {
            queue
                .next()
                .map(|name| format!("{asset_prefix}/{name}"))
                .unwrap_or_default()
        });

        if !markdown.trim().is_empty() {
            chunks.push(markdown.trim_end().to_string());
        }
    }

    let mut out = chunks.join("\n\n");
    if !out.is_empty() {
        out.push('\n');
    }
    Ok(out)
}

/// Renders each page that has equations once and crops every region out of it,
/// returning the written filenames per page index.
#[cfg(feature = "pdf-native")]
fn crop_regions(
    pdf_path: &Path,
    wanted: &[(usize, Vec<layout::Rect>)],
    assets_dir: &Path,
) -> Result<std::collections::HashMap<usize, Vec<String>>> {
    use pdfium_render::prelude::PdfRenderConfig;

    let pdfium = super::renderer::bind_pdfium()?;
    let doc = pdfium.load_pdf_from_file(pdf_path, None)?;
    let mut out = std::collections::HashMap::new();
    let mut counter = 0usize;

    for (page_index, rects) in wanted {
        let page = doc
            .pages()
            .get(*page_index as i32)
            .map_err(|e| anyhow::anyhow!("page {page_index} could not be opened: {e}"))?;

        let page_width = page.width().value;
        let page_height = page.height().value;

        let bitmap = page.render_with_config(
            &PdfRenderConfig::new()
                .set_target_width((page_width * MATHS_RENDER_SCALE) as u16 as i32),
        )?;
        let (width, height) = (bitmap.width() as u32, bitmap.height() as u32);
        // Built through our own `image` crate rather than bitmap.as_image(), for
        // the same reason render_pages does — see the note there.
        let rendered = image::RgbaImage::from_raw(width, height, bitmap.as_rgba_bytes())
            .ok_or_else(|| anyhow::anyhow!("page {page_index} had a mismatched pixel buffer"))?;

        let mut names = Vec::new();
        for rect in rects {
            let (x, y, w, h) = rect
                .padded(MATHS_CROP_PAD)
                .to_pixels(page_width, page_height, width, height);
            let cropped = image::imageops::crop_imm(&rendered, x, y, w, h).to_image();

            counter += 1;
            let name = format!("eq-{counter}.png");
            cropped.save(assets_dir.join(&name))?;
            names.push(name);
        }
        out.insert(*page_index, names);
    }
    Ok(out)
}

#[cfg(not(feature = "pdf-native"))]
fn crop_regions(
    _pdf_path: &Path,
    _wanted: &[(usize, Vec<layout::Rect>)],
    _assets_dir: &Path,
) -> Result<std::collections::HashMap<usize, Vec<String>>> {
    anyhow::bail!("cropping equations requires the pdf-native feature")
}

/// Breathing room around a cropped equation, in PDF points.
const MATHS_CROP_PAD: f32 = 1.5;

pub fn extract_pages(pdf_path: &Path) -> Result<Vec<ExtractedPage>> {
    #[cfg(feature = "pdf-native")]
    {
        extract_pages_native(pdf_path)
    }
    #[cfg(not(feature = "pdf-native"))]
    {
        anyhow::bail!(
            "PDF text extraction requires the pdf-native feature: {:?}",
            pdf_path
        )
    }
}

#[cfg(feature = "pdf-native")]
fn extract_pages_native(pdf_path: &Path) -> Result<Vec<ExtractedPage>> {
    use pdfium_render::prelude::PdfFontWeight;

    let pdfium = super::renderer::bind_pdfium()?;
    let doc = pdfium.load_pdf_from_file(pdf_path, None)?;
    let mut pages = Vec::new();

    for (index, page) in doc.pages().iter().enumerate() {
        let text = page.text()?;
        let mut chars = Vec::new();

        for ch in text.chars().iter() {
            let Some(value) = ch.unicode_char() else {
                continue;
            };
            // pdfium injects synthetic characters that describe the text
            // layer's own structure — CR/LF at every line end, plus spacing
            // markers. They report a font size of 1.0 and zero bounds, and
            // every one of them has an empty font name, which real glyphs
            // never do.
            //
            // They are not merely useless here (lines are grouped by
            // geometry, not by markers): a row that picks one up has its
            // median font size dragged to 1.0, which collapses the baseline
            // tolerance to 0.4pt and stops the row grouping anything at all.
            if ch.font_name().is_empty() || value.is_control() {
                continue;
            }
            // loose_bounds covers the glyph's advance box rather than its inked
            // extent, which is what the space-detection gap logic needs — a
            // comma's tight bounds would leave a gap wide enough to fake a
            // space after every one.
            let Ok(bounds) = ch.loose_bounds() else {
                continue;
            };
            let Ok(origin_y) = ch.origin_y() else {
                continue;
            };

            let font = ch.font_name();
            chars.push(CharBox {
                ch: value,
                x: bounds.left().value,
                y: origin_y.value,
                width: bounds.width().value,
                top: bounds.top().value,
                bottom: bounds.bottom().value,
                maths: super::maths::is_maths_font(&font),
                symbol: super::maths::is_symbol_font(&font),
                font_size: ch.scaled_font_size().value,
                bold: matches!(
                    ch.font_weight(),
                    Some(PdfFontWeight::Weight700Bold)
                        | Some(PdfFontWeight::Weight800)
                        | Some(PdfFontWeight::Weight900)
                ) || ch.font_is_bold_reenforced(),
                italic: ch.font_is_italic(),
                fixed_pitch: ch.font_is_fixed_pitch(),
            });
        }

        pages.push(ExtractedPage { index, chars });
    }

    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn char_at(ch: char, x: f32, y: f32) -> CharBox {
        CharBox {
            ch,
            x,
            y,
            width: 5.0,
            top: y + 7.5,
            bottom: y - 2.5,
            font_size: 10.0,
            bold: false,
            italic: false,
            fixed_pitch: false,
            maths: false,
            symbol: false,
        }
    }

    fn page_of(text: &str) -> ExtractedPage {
        ExtractedPage {
            index: 0,
            chars: text
                .chars()
                .enumerate()
                .map(|(i, c)| char_at(c, 72.0 + i as f32 * 5.0, 700.0))
                .collect(),
        }
    }

    #[test]
    fn a_page_with_almost_no_text_reads_as_empty() {
        assert!(page_of("Fig. 1").is_effectively_empty());
        assert!(ExtractedPage { index: 0, chars: vec![] }.is_effectively_empty());
    }

    #[test]
    fn a_page_of_real_prose_does_not_read_as_empty() {
        assert!(!page_of("This is a real sentence with plenty of characters.").is_effectively_empty());
    }

    // Whitespace is not content — a page of spaces is still a scan.
    #[test]
    fn whitespace_does_not_count_towards_the_text_threshold() {
        assert!(page_of(&" ".repeat(200)).is_effectively_empty());
    }

    #[test]
    fn pages_are_concatenated_into_one_document() {
        let pages = vec![page_of("First page text here."), page_of("Second page text.")];

        let markdown = pages_to_markdown(&pages);

        assert_eq!(markdown, "First page text here.\n\nSecond page text.\n");
    }

    #[test]
    fn a_blank_page_does_not_leave_a_hole_in_the_document() {
        let pages = vec![
            page_of("Real content."),
            ExtractedPage { index: 1, chars: vec![] },
            page_of("More content."),
        ];

        assert_eq!(pages_to_markdown(&pages), "Real content.\n\nMore content.\n");
    }
}
