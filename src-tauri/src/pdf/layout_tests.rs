//! Tests for the layout reconstruction, built on a tiny typesetter that lays
//! out text the way a PDF does: baselines descending the page, each glyph
//! advancing x by its width. Nothing here needs pdfium.

use super::layout::*;

const BODY: f32 = 10.0;
// Roughly a Times-ish advance; only the ratio to font_size matters.
const ADVANCE: f32 = 0.5;

#[derive(Clone, Copy)]
struct Style {
    size: f32,
    bold: bool,
    italic: bool,
    fixed: bool,
    maths: bool,
    symbol: bool,
}

impl Default for Style {
    fn default() -> Self {
        Style {
            size: BODY,
            bold: false,
            italic: false,
            fixed: false,
            maths: false,
            symbol: false,
        }
    }
}

/// A maths *symbol* face — an arrow, an operator, a radical. Something text
/// cannot express, so a region containing it earns a crop.
fn maths() -> Style {
    Style {
        maths: true,
        symbol: true,
        ..Style::default()
    }
}

/// Maths *italic* — the variable alphabet. A lone letter from it is ordinary
/// italic text and is deliberately not cropped.
fn maths_italic() -> Style {
    Style {
        maths: true,
        ..Style::default()
    }
}

/// Lays one line of text out at (x, y), returning its characters.
fn set(text: &str, x: f32, y: f32, style: Style) -> Vec<CharBox> {
    let mut out = Vec::new();
    let mut cursor = x;
    let width = style.size * ADVANCE;
    for ch in text.chars() {
        out.push(CharBox {
            ch,
            x: cursor,
            y,
            width,
            // A glyph box roughly the em square, sitting on the baseline.
            top: y + style.size * 0.75,
            bottom: y - style.size * 0.25,
            font_size: style.size,
            bold: style.bold,
            italic: style.italic,
            fixed_pitch: style.fixed,
            maths: style.maths,
            symbol: style.symbol,
        });
        cursor += width;
    }
    out
}

/// Lays out consecutive body-text lines downward from `top`.
fn page_at(top: f32, lines: &[&str]) -> Vec<CharBox> {
    let mut out = Vec::new();
    for (index, text) in lines.iter().enumerate() {
        out.extend(set(text, 72.0, top - index as f32 * 12.0, Style::default()));
    }
    out
}

fn page(lines: &[&str]) -> Vec<CharBox> {
    page_at(700.0, lines)
}

#[test]
fn groups_characters_sharing_a_baseline_into_one_line() {
    let lines = group_lines(&page(&["hello world"]));
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].text(), "hello world");
}

#[test]
fn separates_lines_by_baseline_and_orders_them_down_the_page() {
    let lines = group_lines(&page(&["first", "second", "third"]));
    let texts: Vec<String> = lines.iter().map(|l| l.text()).collect();
    assert_eq!(texts, ["first", "second", "third"]);
}

// A subscript or inline-maths glyph sits off the baseline but belongs to the
// line it is printed on.
#[test]
fn keeps_a_slightly_raised_glyph_on_its_own_line() {
    let mut chars = set("x", 72.0, 700.0, Style::default());
    chars.extend(set("2", 77.0, 703.0, Style { size: 7.0, ..Style::default() }));
    chars.extend(set(" ok", 82.0, 700.0, Style::default()));

    let lines = group_lines(&chars);

    assert_eq!(lines.len(), 1, "expected one line, got {lines:?}");
    assert!(lines[0].text().starts_with("x2"));
}

// PDFs commonly position words by moving the cursor rather than emitting a
// space glyph; without synthesising one the words run together.
#[test]
fn synthesises_a_space_from_a_wide_cursor_jump() {
    let mut chars = set("hello", 72.0, 700.0, Style::default());
    chars.extend(set("world", 72.0 + 5.0 * 5.0 + 6.0, 700.0, Style::default()));

    let lines = group_lines(&chars);

    assert_eq!(lines[0].text(), "hello world");
}

#[test]
fn does_not_invent_a_space_between_adjacent_glyphs() {
    let lines = group_lines(&set("adjacent", 72.0, 700.0, Style::default()));
    assert_eq!(lines[0].text(), "adjacent");
}

#[test]
fn body_size_is_the_size_most_characters_use_not_the_commonest_line() {
    let mut chars = set("Big", 72.0, 700.0, Style { size: 20.0, ..Style::default() });
    chars.extend(set("Also", 72.0, 660.0, Style { size: 20.0, ..Style::default() }));
    chars.extend(page_at(600.0, &["a much longer run of ordinary body text here"]));

    let lines = group_lines(&chars);

    assert_eq!(body_font_size(&lines), BODY);
}

#[test]
fn a_larger_line_becomes_a_heading_and_body_stays_prose() {
    let mut chars = set("Exercise Sheet 3", 72.0, 700.0, Style { size: 17.0, ..Style::default() });
    chars.extend(page_at(680.0, &["some ordinary body text that sets the body size"]));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.starts_with("# Exercise Sheet 3\n"), "got: {markdown}");
    assert!(markdown.contains("some ordinary body text"));
}

#[test]
fn heading_level_follows_relative_size() {
    let body_line = "ordinary body text long enough to dominate the size vote";

    for (size, expected) in [(17.0, "#"), (14.0, "##"), (12.0, "###")] {
        let mut chars = set("Title", 72.0, 700.0, Style { size, ..Style::default() });
        chars.extend(page_at(680.0, &[body_line]));

        let markdown = chars_to_markdown(&chars);

        assert!(
            markdown.starts_with(&format!("{expected} Title\n")),
            "size {size} expected {expected}, got: {markdown}"
        );
    }
}

#[test]
fn consecutive_lines_reflow_into_one_paragraph() {
    let markdown = chars_to_markdown(&page(&[
        "a sentence that runs on",
        "across a second line",
        "and a third",
    ]));

    assert_eq!(
        markdown,
        "a sentence that runs on across a second line and a third\n"
    );
}

// pdfium reports a discretionary hyphen as U+0002 with its is_hyphen flag set,
// which extraction turns into a soft hyphen. It is the only record that the two
// halves are one word — the geometry says nothing, and pdfium's line marker
// appears at every line end whether a word was split or not. Found on a real
// sheet, which read "Entwicklungsstel le".
#[test]
fn a_word_broken_across_a_line_closes_up_again() {
    let mut chars = set("an der Entwicklungsstel", 72.0, 700.0, Style::default());
    chars.extend(set(
        &SOFT_HYPHEN.to_string(),
        72.0 + 23.0 * 5.0,
        700.0,
        Style::default(),
    ));
    chars.extend(set("le folgt daraus", 72.0, 688.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "an der Entwicklungsstelle folgt daraus\n");
}

#[test]
fn the_break_marker_never_survives_into_the_note() {
    let mut chars = set("wort", 72.0, 700.0, Style::default());
    chars.extend(set(&SOFT_HYPHEN.to_string(), 92.0, 700.0, Style::default()));

    assert_eq!(chars_to_markdown(&chars), "wort\n");
}

#[test]
fn a_line_that_merely_ends_still_gets_its_space() {
    let mut chars = set("erster Teil", 72.0, 700.0, Style::default());
    chars.extend(set("zweiter Teil", 72.0, 688.0, Style::default()));

    assert_eq!(chars_to_markdown(&chars), "erster Teil zweiter Teil\n");
}

#[test]
fn a_wide_vertical_gap_splits_paragraphs() {
    let mut chars = Vec::new();
    for (index, text) in ["first para line one", "first para line two"].iter().enumerate() {
        chars.extend(set(text, 72.0, 700.0 - index as f32 * 12.0, Style::default()));
    }
    // Two blank lines' worth of space.
    chars.extend(set("second paragraph", 72.0, 700.0 - 2.0 * 12.0 - 24.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(
        markdown,
        "first para line one first para line two\n\nsecond paragraph\n"
    );
}

#[test]
fn a_monospace_run_becomes_a_fenced_code_block_keeping_its_line_breaks() {
    let mut chars = page(&["Consider the following program."]);
    let code = Style { fixed: true, ..Style::default() };
    chars.extend(set("fn main() {", 72.0, 660.0, code));
    chars.extend(set("    println!();", 72.0, 648.0, code));
    chars.extend(set("}", 72.0, 636.0, code));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains("```\nfn main() {\n    println!();\n}\n```"),
        "got: {markdown}"
    );
}

#[test]
fn code_does_not_swallow_the_prose_that_follows_it() {
    let mut chars = set("fn main() {}", 72.0, 700.0, Style { fixed: true, ..Style::default() });
    chars.extend(set("That was the program.", 72.0, 688.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("```\nfn main() {}\n```"), "got: {markdown}");
    assert!(markdown.ends_with("That was the program.\n"), "got: {markdown}");
}

#[test]
fn bulleted_lines_become_list_items_with_the_marker_removed() {
    let mut chars = page(&["Prove the following statements about the set."]);
    chars.extend(set("• first claim", 72.0, 660.0, Style::default()));
    chars.extend(set("• second claim", 72.0, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("- first claim"), "got: {markdown}");
    assert!(markdown.contains("- second claim"), "got: {markdown}");
    assert!(!markdown.contains('•'), "marker survived: {markdown}");
}

#[test]
fn numbered_lines_become_an_ordered_list() {
    let mut chars = page(&["Answer each of the parts below in turn."]);
    chars.extend(set("1. first part", 72.0, 660.0, Style::default()));
    chars.extend(set("2. second part", 72.0, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    // The source's own numbers, not a renumbering from 1 — on an exercise
    // sheet that would quietly rename the exercises.
    assert!(markdown.contains("1. first part"), "got: {markdown}");
    assert!(markdown.contains("2. second part"), "got: {markdown}");
}

#[test]
fn a_sub_part_label_becomes_a_list_item() {
    let mut chars = page(&["Answer each of the parts below in turn."]);
    chars.extend(set("(a) the first part", 72.0, 660.0, Style::default()));
    chars.extend(set("(b) the second part", 72.0, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("1. the first part"), "got: {markdown}");
    assert!(markdown.contains("1. the second part"), "got: {markdown}");
}

#[test]
fn a_standalone_accent_glyph_recomposes_with_its_letter() {
    // Computer Modern prints "für" as u + a separate diaeresis positioned
    // over it, which arrives as "fu¨r" unless it is put back together.
    let markdown = chars_to_markdown(&page(&["fu\u{00A8}r Informatikstudien"]));
    assert!(markdown.starts_with("für"), "got: {markdown}");
}

// Found against a real sheet: the footnote marker sorts first because it is
// raised, and anchoring the row's tolerance to it shifted the whole window up
// far enough to drop the umlaut of "abzuschätzen" onto a line of its own.
#[test]
fn a_raised_footnote_marker_does_not_push_a_diacritic_off_the_line() {
    let mut chars = set("abzuschatzen", 111.7, 495.73, Style { size: 12.0, ..Style::default() });
    chars.extend(set("1", 179.1, 500.0, Style { size: 8.0, ..Style::default() }));
    // The umlaut, at exactly the x of the second "a" it sits over — an accent
    // shares its letter's position rather than following it.
    let second_a = 111.7 + 7.0 * 12.0 * ADVANCE;
    chars.extend(set("\u{00A8}", second_a, 495.26, Style { size: 12.0, ..Style::default() }));

    let lines = group_lines(&chars);

    assert_eq!(lines.len(), 1, "expected one line, got {lines:?}");
    assert!(lines[0].text().contains("abzuschätzen"), "got: {}", lines[0].text());
}

#[test]
fn an_accent_with_no_letter_before_it_is_left_alone() {
    let markdown = chars_to_markdown(&page(&["\u{00A8} alone on the line"]));
    assert!(markdown.contains('\u{00A8}'), "got: {markdown}");
}

#[test]
fn an_indented_item_nests_under_the_one_above() {
    let mut chars = page(&["Consider the following cases in order of difficulty."]);
    chars.extend(set("• outer", 72.0, 660.0, Style::default()));
    chars.extend(set("• inner", 72.0 + 2.0 * BODY, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("- outer"), "got: {markdown}");
    assert!(markdown.contains("  - inner"), "got: {markdown}");
}

// A hyphen followed by a digit is a minus sign, and an asterisk hugging a word
// is emphasis; neither opens a list.
#[test]
fn a_bare_hyphen_or_asterisk_does_not_start_a_list() {
    let markdown = chars_to_markdown(&page(&["-3 degrees below the freezing point"]));
    assert!(markdown.starts_with("-3 degrees"), "got: {markdown}");
}

#[test]
fn a_wrapped_list_item_keeps_its_continuation_line() {
    let mut chars = page(&["Prove each of the following claims carefully."]);
    chars.extend(set("• a claim that runs on", 72.0, 660.0, Style::default()));
    chars.extend(set("past the end of the line", 72.0 + 5.0, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains("- a claim that runs on past the end of the line"),
        "got: {markdown}"
    );
}

#[test]
fn bold_and_italic_runs_become_markdown_emphasis() {
    let mut chars = set("plain ", 72.0, 700.0, Style::default());
    chars.extend(set("bold", 72.0 + 6.0 * 5.0, 700.0, Style { bold: true, ..Style::default() }));
    chars.extend(set(" and ", 72.0 + 10.0 * 5.0, 700.0, Style::default()));
    chars.extend(set("italic", 72.0 + 15.0 * 5.0, 700.0, Style { italic: true, ..Style::default() }));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "plain **bold** and *italic*\n");
}

// "** bold **" is not emphasis in Markdown — the padding has to sit outside.
#[test]
fn emphasis_markers_never_wrap_surrounding_whitespace() {
    let mut chars = set("see ", 72.0, 700.0, Style::default());
    chars.extend(set("word ", 72.0 + 4.0 * 5.0, 700.0, Style { bold: true, ..Style::default() }));
    chars.extend(set("after", 72.0 + 9.0 * 5.0, 700.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    // The bold run is "word " — trailing space and all. It has to come out as
    // "**word** after", never "**word ** after".
    assert_eq!(markdown, "see **word** after\n");
}

// The text layer has no LaTeX in it — an equation is a run of glyphs in maths
// fonts, and reading it as text gives confident nonsense. These check it comes
// out as a crop instead.
#[test]
fn a_line_that_is_all_maths_becomes_a_standalone_image() {
    let mut chars = page(&["Consider the following identity."]);
    chars.extend(set("f(x) = x2 + 1", 200.0, 660.0, maths()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("![](maths-1.png)"), "got: {markdown}");
    // None of the glyph soup should survive as text.
    assert!(!markdown.contains("x2 + 1"), "maths leaked as text: {markdown}");
}

// Most inline maths on a real sheet is one italic variable. Cropping each one
// litters the note with postage stamps that read worse than the letter would.
#[test]
fn a_lone_italic_variable_stays_text_rather_than_becoming_an_image() {
    let mut chars = set("der Wert von ", 72.0, 700.0, Style::default());
    chars.extend(set("f", 72.0 + 13.0 * 5.0, 700.0, maths_italic()));
    chars.extend(set(" an der Stelle", 72.0 + 14.0 * 5.0, 700.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(!markdown.contains("!["), "cropped a bare variable: {markdown}");
    assert!(markdown.contains('f'), "lost the variable: {markdown}");
}

// A subscript is the point at which text stops being able to say it.
#[test]
fn a_subscripted_variable_is_cropped() {
    let mut chars = set("T", 200.0, 700.0, maths_italic());
    chars.extend(set("1", 205.0, 697.0, Style { size: 8.0, ..Style::default() }));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("!["), "expected a crop: {markdown}");
}

#[test]
fn maths_inside_a_sentence_stays_inside_it() {
    let mut chars = set("Sei ", 72.0, 700.0, Style::default());
    chars.extend(set("f : R", 72.0 + 4.0 * 5.0, 700.0, maths()));
    chars.extend(set(" gegeben und stetig", 72.0 + 9.0 * 5.0, 700.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "Sei ![](maths-1.png) gegeben und stetig\n");
}

// "f : R² → R" sets the colon and the exponent in the body font, so a region
// has to absorb what sits between two maths glyphs.
#[test]
fn a_region_bridges_body_font_characters_inside_an_equation() {
    let mut chars = set("f", 200.0, 700.0, maths());
    chars.extend(set(" : ", 205.0, 700.0, Style::default()));
    chars.extend(set("R", 220.0, 700.0, maths()));

    let lines = group_lines(&chars);

    let regions: Vec<_> = lines[0]
        .content
        .iter()
        .filter(|i| matches!(i, Inline::Maths(_)))
        .collect();
    assert_eq!(regions.len(), 1, "expected one region, got {:?}", lines[0].content);
}

#[test]
fn prose_far_from_an_equation_is_not_swallowed_into_it() {
    let mut chars = set("x", 72.0, 700.0, maths());
    // Well beyond the bridging distance.
    chars.extend(set("und", 72.0 + 40.0, 700.0, Style::default()));
    chars.extend(set("y", 72.0 + 100.0, 700.0, maths()));

    let lines = group_lines(&chars);

    let regions = lines[0].content.iter().filter(|i| matches!(i, Inline::Maths(_))).count();
    assert_eq!(regions, 2, "got: {:?}", lines[0].content);
    assert!(lines[0].text().contains("und"), "prose lost: {}", lines[0].text());
}

#[test]
fn a_crop_region_covers_the_full_height_of_its_glyphs() {
    let mut chars = set("x", 200.0, 700.0, maths());
    // An exponent, sitting above the baseline.
    chars.extend(set("2", 205.0, 704.0, Style { size: 7.0, maths: true, ..Style::default() }));

    let lines = group_lines(&chars);

    let Some(Inline::Maths(rect)) = lines[0].content.iter().find(|i| matches!(i, Inline::Maths(_)))
    else {
        panic!("no region in {:?}", lines[0].content)
    };
    // Tall enough to hold the exponent's top and the base glyph's bottom.
    assert!(rect.y1 >= 704.0 + 7.0 * 0.75 - 0.01, "top too low: {rect:?}");
    assert!(rect.y0 <= 700.0 - BODY * 0.25 + 0.01, "bottom too high: {rect:?}");
}

#[test]
fn maths_rects_are_listed_in_the_order_the_markdown_asks_for_them() {
    let mut chars = set("a", 72.0, 700.0, maths());
    chars.extend(set("text between them here", 72.0 + 60.0, 700.0, Style::default()));
    chars.extend(set("b", 72.0 + 220.0, 700.0, maths()));

    let blocks = group_blocks(&group_lines(&chars));
    let rects = maths_rects(&blocks);

    assert_eq!(rects.len(), 2);
    assert!(rects[0].x0 < rects[1].x0, "out of reading order: {rects:?}");
}

#[test]
fn a_page_with_no_maths_asks_for_no_crops() {
    let blocks = group_blocks(&group_lines(&page(&["just ordinary prose here"])));
    assert!(maths_rects(&blocks).is_empty());
}

// PDF space starts at the bottom-left, an image at the top-left. Getting this
// backwards crops the mirror image of the equation.
#[test]
fn a_rect_maps_onto_the_rendered_page_flipped_vertically() {
    // A4-ish page, rendered at 2x.
    let rect = Rect { x0: 100.0, y0: 700.0, x1: 200.0, y1: 720.0 };

    let (x, y, w, h) = rect.to_pixels(600.0, 800.0, 1200, 1600);

    assert_eq!(x, 200, "left edge");
    // 800 - 720 = 80 points from the top, doubled.
    assert_eq!(y, 160, "top edge measured down from the top of the page");
    assert_eq!(w, 200);
    assert_eq!(h, 40);
}

#[test]
fn a_rect_is_clamped_to_the_image_and_never_zero_sized() {
    let outside = Rect { x0: -50.0, y0: -50.0, x1: 5000.0, y1: 5000.0 };
    let (x, y, w, h) = outside.to_pixels(600.0, 800.0, 1200, 1600);
    assert_eq!((x, y), (0, 0));
    assert!(x + w <= 1200 && y + h <= 1600, "escaped the image: {w}x{h}");

    let degenerate = Rect { x0: 100.0, y0: 100.0, x1: 100.0, y1: 100.0 };
    let (_, _, w, h) = degenerate.to_pixels(600.0, 800.0, 1200, 1600);
    assert!(w >= 1 && h >= 1, "zero-sized crop: {w}x{h}");
}

#[test]
fn an_empty_page_produces_an_empty_document() {
    assert_eq!(chars_to_markdown(&[]), "");
    assert!(group_lines(&[]).is_empty());
    assert!(group_blocks(&[]).is_empty());
}

#[test]
fn whitespace_only_lines_are_dropped_rather_than_becoming_paragraphs() {
    let mut chars = set("real text", 72.0, 700.0, Style::default());
    chars.extend(set("   ", 72.0, 688.0, Style::default()));
    chars.extend(set("more text", 72.0, 676.0, Style::default()));

    let blocks = group_blocks(&group_lines(&chars));

    assert!(
        blocks.iter().all(|b| !matches!(b, Block::Paragraph { content } if content.is_empty())),
        "got: {blocks:?}"
    );
}

// The shape a real exercise sheet arrives in, end to end.
#[test]
fn converts_a_representative_exercise_sheet() {
    let mut chars = set("Aufgabe 1", 72.0, 700.0, Style { size: 15.0, ..Style::default() });
    chars.extend(set("Sei G eine endliche Gruppe. Zeigen Sie, dass", 72.0, 680.0, Style::default()));
    chars.extend(set("die folgenden Aussagen gelten.", 72.0, 668.0, Style::default()));
    chars.extend(set("• G ist abelsch", 72.0, 644.0, Style::default()));
    chars.extend(set("• G ist zyklisch", 72.0, 632.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(
        markdown,
        "## Aufgabe 1\n\n\
         Sei G eine endliche Gruppe. Zeigen Sie, dass die folgenden Aussagen gelten.\n\n\
         - G ist abelsch\n\n\
         - G ist zyklisch\n"
    );
}
