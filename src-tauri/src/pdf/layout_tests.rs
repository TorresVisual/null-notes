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
}

impl Default for Style {
    fn default() -> Self {
        Style {
            size: BODY,
            bold: false,
            italic: false,
            fixed: false,
        }
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
            font_size: style.size,
            bold: style.bold,
            italic: style.italic,
            fixed_pitch: style.fixed,
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
        blocks.iter().all(|b| !matches!(b, Block::Paragraph { spans } if spans.is_empty())),
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
