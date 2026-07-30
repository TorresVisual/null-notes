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

/// No real glyph in any document this pipeline has been run against is ever
/// set this small; pdfium's own layout filler (CR/LF markers, paragraph and
/// word-gap padding) consistently measures 1.0pt regardless of the
/// surrounding text's real size.
const LAYOUT_FILLER_MAX_SIZE: f32 = 1.5;

/// Whether a character this small is pdfium's own layout filler rather than a
/// real, if tiny, glyph.
///
/// Deliberately **not** based on an empty `font_name()`. That used to be the
/// signal, and held for the first document this pipeline was built against —
/// but a font name is producer-dependent: one real PDF's actual body-text
/// font reports an empty name too, through no fault of its own, and that
/// version of the check silently discarded every word of prose in it.
fn is_layout_filler(font_size: f32) -> bool {
    font_size <= LAYOUT_FILLER_MAX_SIZE
}

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
            // layer's own structure — CR/LF at every line end, plus filler
            // marking a paragraph or word gap. They are not merely useless
            // here (lines are grouped by geometry, not by markers): a row that
            // picks one up has its median font size dragged toward whatever
            // degenerate size the filler reports, which can collapse the
            // baseline tolerance and stop the row grouping anything at all.
            //
            // One control character is worth keeping. A word broken across a
            // line arrives as "…Entwicklungsstel", U+0002, "le" — pdfium
            // reports that U+0002 as `is_hyphen`, and it is the *only* record
            // that the two halves are one word. Nothing in the geometry says
            // so, and pdfium's line marker appears at every line end whether a
            // word was split or not. It becomes a soft hyphen for the layout
            // to reflow across.
            let hyphenation_break = ch.is_hyphen().unwrap_or(false);
            if !hyphenation_break
                && (is_layout_filler(ch.scaled_font_size().value) || value.is_control())
            {
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
                ch: if hyphenation_break {
                    layout::SOFT_HYPHEN
                } else {
                    value
                },
                x: bounds.left().value,
                y: origin_y.value,
                width: bounds.width().value,
                top: bounds.top().value,
                bottom: bounds.bottom().value,
                family: super::maths::family_of(&font),
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

    // pdfium's own layout filler consistently measures 1.0pt in every
    // document seen; ordinary superscripts/subscripts still sit well above
    // this (a 12pt line's script is usually ~8pt), and body text can be
    // 8pt+ in a footnote or caption, so the cutoff has real headroom on
    // both sides.
    #[test]
    fn a_degenerate_size_is_layout_filler() {
        assert!(is_layout_filler(1.0));
        assert!(is_layout_filler(0.0));
    }

    #[test]
    fn ordinary_text_at_any_real_size_is_not_filler() {
        assert!(!is_layout_filler(7.97)); // a real subscript/superscript
        assert!(!is_layout_filler(11.96)); // ordinary body text
        assert!(!is_layout_filler(24.79)); // a heading
    }

    // The bug this guards: one real PDF's body-text font reported an empty
    // font_name() through pdfium for entirely legitimate prose, and a filter
    // keyed on font-name emptiness discarded every word of it. Size is the
    // only signal that told the two apart.
    #[test]
    fn an_empty_font_name_alone_is_not_evidence_of_filler() {
        assert!(!is_layout_filler(11.96), "a real 11.96pt glyph must never read as filler regardless of its font name");
    }

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
            family: super::super::maths::Family::Text,
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
