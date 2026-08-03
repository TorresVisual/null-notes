//! Pulls the character geometry out of a PDF's text layer.
//!
//! Kept deliberately thin: everything it does is translate pdfium's types into
//! the plain [`CharBox`](super::layout::CharBox) values that
//! [`layout`](super::layout) reasons about. All the judgement lives there,
//! where it can be tested without the native library.

use super::columns;
use super::layout::{self, CharBox};
use super::models;
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
pub struct ExtractedImage {
    /// PNG-encoded bytes, ready to write to disk as-is.
    pub data: Vec<u8>,
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
    pub top: f32,
}

#[derive(Debug, Clone)]
pub struct ExtractedPage {
    pub index: usize,
    pub chars: Vec<CharBox>,
    pub images: Vec<ExtractedImage>,
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

/// Renders every page's text layer, with images interleaved into reading
/// order, to Markdown, one document. Images are referenced by placeholder
/// — see `pdf::models::PendingImage`.
pub fn pages_to_markdown(pages: &[ExtractedPage]) -> models::PdfMarkdownImport {
    let mut chunks: Vec<String> = Vec::new();
    let mut pending: Vec<models::PendingImage> = Vec::new();
    let mut next_placeholder = 0usize;

    for page in pages {
        let regions = columns::segment_regions(&page.chars);

        if regions.is_empty() {
            // No text on this page at all. An ordinary blank page has no
            // images either and is skipped, unchanged from today — but a
            // page that is *entirely* one large figure (no text layer of
            // its own) still has images worth keeping rather than silently
            // losing an entire page's content.
            if page.images.is_empty() {
                continue;
            }
            let image_refs = take_images_as_refs(&page.images, &mut pending, &mut next_placeholder);
            let markdown = layout::chars_and_images_to_markdown(&[], &image_refs);
            if !markdown.trim().is_empty() {
                chunks.push(markdown.trim_end().to_string());
            }
            continue;
        }

        let region_bounds: Vec<(f32, f32)> =
            regions.iter().map(|r| layout::row_x_extent(r)).collect();
        let mut images_by_region: Vec<Vec<&ExtractedImage>> = vec![Vec::new(); regions.len()];
        for img in &page.images {
            let center_x = (img.left + img.right) / 2.0;
            if let Some((best_index, _)) = region_bounds
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    x_distance(center_x, a)
                        .partial_cmp(&x_distance(center_x, b))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
            {
                images_by_region[best_index].push(img);
            }
        }

        for (region, imgs) in regions.iter().zip(images_by_region) {
            let owned: Vec<ExtractedImage> = imgs.into_iter().cloned().collect();
            let image_refs = take_images_as_refs(&owned, &mut pending, &mut next_placeholder);
            let markdown = layout::chars_and_images_to_markdown(region, &image_refs);
            if !markdown.trim().is_empty() {
                chunks.push(markdown.trim_end().to_string());
            }
        }
    }

    let mut markdown = chunks.join("\n\n");
    if !markdown.is_empty() {
        markdown.push('\n');
    }
    models::PdfMarkdownImport { markdown, images: pending }
}

/// Distance from `x` to the nearest edge of `bounds` — `0.0` when `x` falls
/// inside it. Used to assign an image that doesn't cleanly land inside any
/// single multi-column region (e.g. one spanning a gutter) to whichever
/// region is closest, rather than dropping it.
fn x_distance(x: f32, bounds: &(f32, f32)) -> f32 {
    let (x0, x1) = *bounds;
    if x < x0 {
        x0 - x
    } else if x > x1 {
        x - x1
    } else {
        0.0
    }
}

/// Converts a page's raw extracted images into placeholder-tagged
/// `layout::ImageRef`s, pushing each one's bytes onto `pending` (the list
/// `pages_to_markdown` ultimately returns) as it goes.
fn take_images_as_refs(
    images: &[ExtractedImage],
    pending: &mut Vec<models::PendingImage>,
    next_placeholder: &mut usize,
) -> Vec<layout::ImageRef> {
    images
        .iter()
        .map(|img| {
            let placeholder = format!("pdf-image://{next_placeholder}");
            *next_placeholder += 1;
            pending.push(models::PendingImage {
                placeholder: placeholder.clone(),
                mime: "image/png".to_string(),
                data: img.data.clone(),
            });
            layout::ImageRef {
                placeholder,
                alt: String::new(),
                left: img.left,
                right: img.right,
                y: (img.top + img.bottom) / 2.0,
            }
        })
        .collect()
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
    use pdfium_render::prelude::{PdfFontWeight, PdfPageObject, PdfPageObjectsCommon};

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
            if !hyphenation_break && is_layout_filler(ch.scaled_font_size().value) {
                continue;
            }
            // A real (non-filler) glyph pdfium cannot map to a genuine
            // Unicode value — confirmed, via both the per-character API used
            // here and the separate `FPDFText_GetBoundedText` path `dump.rs`
            // cross-checked it against, to be the same underdetermined
            // result rather than an artifact of this extraction path. Most
            // often a ligature (ff/fi/ffi) in a font whose ToUnicode CMap has
            // no entry for it. Which letters it actually represents is
            // producer- and font-specific — the same codepoint means
            // something else in a different document's font, exactly like
            // the `ß`/`∮` glyph-identity problems in `maths.rs`/`latex.rs` —
            // so guessing the letters is not safe here either.
            //
            // Dropping it outright, the previous behaviour, is worse than
            // showing the loss: the glyph vanishes but its geometric slot
            // does not, and the resulting gap reads to the space
            // synthesizer as an ordinary word boundary —
            // "Differentialgleichung" silently became the two perfectly
            // plausible words "Di erentialgleichung", with nothing to flag
            // the sentence as broken. Keeping it as U+FFFD keeps the glyph's
            // geometry in its row, so the word stays one word, and makes the
            // loss visible instead of silent.
            let value = if !hyphenation_break && value.is_control() {
                '\u{FFFD}'
            } else {
                value
            };
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

        let mut images = Vec::new();
        for object in page.objects().iter() {
            let PdfPageObject::Image(ref image_object) = object else {
                continue;
            };
            if let Some(extracted) = extract_image(image_object, &doc) {
                images.push(extracted);
            }
        }

        pages.push(ExtractedPage { index, chars, images });
    }

    Ok(pages)
}

/// Pulls one embedded raster image's bytes and page bounds out of an image
/// page object. `None` — never an error — when pdfium can't decode this
/// particular image: one bad embedded image must not fail the whole
/// document, the same posture a bad equation already gets (it renders its
/// own KaTeX error rather than breaking the page around it).
///
/// `get_processed_bitmap` (not `get_raw_bitmap`) so filters, masks, and
/// object transforms applied to the image are accounted for — the same
/// bitmap-to-PNG path `renderer.rs`'s whole-page rasterization already
/// uses, for the same reason its own comment gives: building the PNG
/// through this crate's own `image` dependency, rather than pdfium-render's
/// optional (and separately-versioned) `image_api` feature, sidesteps a
/// PNG encoder that isn't compiled in by default under that feature.
#[cfg(feature = "pdf-native")]
fn extract_image(
    image_object: &pdfium_render::prelude::PdfPageImageObject,
    doc: &pdfium_render::prelude::PdfDocument,
) -> Option<ExtractedImage> {
    use pdfium_render::prelude::PdfPageObjectCommon;

    let bounds = image_object.bounds().ok()?;
    let bitmap = image_object.get_processed_bitmap(doc).ok()?;
    let (width, height) = (bitmap.width() as u32, bitmap.height() as u32);
    let rgba = bitmap.as_rgba_bytes();
    let img = image::RgbaImage::from_raw(width, height, rgba)?;

    let mut data = Vec::new();
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut std::io::Cursor::new(&mut data), image::ImageOutputFormat::Png)
        .ok()?;

    Some(ExtractedImage {
        data,
        left: bounds.left().value,
        bottom: bounds.bottom().value,
        right: bounds.right().value,
        top: bounds.top().value,
    })
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
            images: Vec::new(),
        }
    }

    #[test]
    fn a_page_with_almost_no_text_reads_as_empty() {
        assert!(page_of("Fig. 1").is_effectively_empty());
        assert!(ExtractedPage { index: 0, chars: vec![], images: Vec::new() }.is_effectively_empty());
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

        let result = pages_to_markdown(&pages);

        assert_eq!(result.markdown, "First page text here.\n\nSecond page text.\n");
        assert!(result.images.is_empty());
    }

    #[test]
    fn a_blank_page_does_not_leave_a_hole_in_the_document() {
        let pages = vec![
            page_of("Real content."),
            ExtractedPage { index: 1, chars: vec![], images: Vec::new() },
            page_of("More content."),
        ];

        assert_eq!(pages_to_markdown(&pages).markdown, "Real content.\n\nMore content.\n");
    }

    fn image_at(left: f32, bottom: f32, right: f32, top: f32) -> ExtractedImage {
        ExtractedImage { data: vec![1, 2, 3, 4], left, bottom, right, top }
    }

    #[test]
    fn an_extracted_image_becomes_a_placeholder_and_a_pending_entry() {
        let mut page = page_of("some text on the page");
        page.images.push(image_at(72.0, 690.0, 300.0, 710.0));

        let result = pages_to_markdown(&[page]);

        assert_eq!(result.images.len(), 1);
        assert_eq!(result.images[0].mime, "image/png");
        assert_eq!(result.images[0].data, vec![1, 2, 3, 4]);
        assert!(
            result.markdown.contains(&format!("![]({})", result.images[0].placeholder)),
            "got: {}",
            result.markdown
        );
    }

    #[test]
    fn a_page_that_is_only_an_image_still_keeps_it() {
        let mut page = ExtractedPage { index: 0, chars: vec![], images: Vec::new() };
        page.images.push(image_at(72.0, 690.0, 300.0, 710.0));

        let result = pages_to_markdown(&[page]);

        assert_eq!(result.images.len(), 1);
        assert!(result.markdown.contains("![]("), "got: {}", result.markdown);
    }

    #[test]
    fn a_page_with_no_text_and_no_images_produces_nothing() {
        let page = ExtractedPage { index: 0, chars: vec![], images: Vec::new() };
        let result = pages_to_markdown(&[page]);
        assert_eq!(result.markdown, "");
        assert!(result.images.is_empty());
    }
}
