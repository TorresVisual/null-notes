//! Tests for the layout reconstruction, built on a tiny typesetter that lays
//! out text the way a PDF does: baselines descending the page, each glyph
//! advancing x by its width. Nothing here needs pdfium.

use super::layout::*;
use super::maths::Family;

const BODY: f32 = 10.0;
// Roughly a Times-ish advance; only the ratio to font_size matters.
const ADVANCE: f32 = 0.5;

#[derive(Clone, Copy)]
struct Style {
    size: f32,
    bold: bool,
    italic: bool,
    fixed: bool,
    family: Family,
}

impl Default for Style {
    fn default() -> Self {
        Style {
            size: BODY,
            bold: false,
            italic: false,
            fixed: false,
            family: Family::Text,
        }
    }
}

/// A maths *symbol* face — an arrow, an operator, a radical.
fn maths() -> Style {
    Style {
        family: Family::Symbol,
        ..Style::default()
    }
}

/// Maths *italic* — the variable alphabet.
fn maths_italic() -> Style {
    Style {
        family: Family::Italic,
        ..Style::default()
    }
}

/// A big extensible operator — ∮, a radical, ∑ — the face that can span
/// several ordinary lines' worth of height.
fn extensible() -> Style {
    Style {
        family: Family::Extensible,
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
            family: style.family,
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

#[test]
fn row_x_extent_spans_the_widest_printing_characters() {
    let row = set("ab", 100.0, 700.0, Style::default());
    let (x0, x1) = row_x_extent(&row);
    assert_eq!(x0, 100.0);
    assert_eq!(x1, 100.0 + 2.0 * BODY * ADVANCE);
}

#[test]
fn row_y_and_font_size_read_off_the_row() {
    let row = set("ab", 100.0, 700.0, Style::default());
    assert_eq!(row_y(&row), 700.0);
    assert_eq!(row_font_size(&row), BODY);
}

#[test]
fn splits_a_row_into_n_groups_at_its_widest_gaps() {
    // Three narrow terms with a wide gap between each — the shape three
    // stacked fractions' numerators take: "1   y^2   y^3".
    let mut row = set("1", 100.0, 700.0, Style::default());
    row.extend(set("y2", 130.0, 700.0, Style::default()));
    row.extend(set("y3", 160.0, 700.0, Style::default()));

    let groups = split_into_terms(&row, 3).expect("expected a confident 3-way split");
    let texts: Vec<String> = groups.iter().map(|g| g.iter().map(|c| c.ch).collect()).collect();
    assert_eq!(texts, ["1", "y2", "y3"]);
}

#[test]
fn refuses_to_split_when_gaps_do_not_clearly_separate() {
    // One evenly-spaced run of letters has no gap that stands out from the
    // rest — forcing a 3-way split here would be a guess, not a measurement.
    let row = set("abcdef", 100.0, 700.0, Style::default());
    assert_eq!(split_into_terms(&row, 3), None);
}

#[test]
fn refuses_to_split_when_there_are_fewer_characters_than_terms() {
    let row = set("ab", 100.0, 700.0, Style::default());
    assert_eq!(split_into_terms(&row, 3), None);
}

#[test]
fn a_single_term_is_the_whole_row_unsplit() {
    let row = set("x + y", 100.0, 700.0, Style::default());
    let groups = split_into_terms(&row, 1).expect("n=1 always succeeds");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].len(), row.iter().filter(|c| !c.ch.is_whitespace()).count());
}

#[test]
fn a_labelled_row_of_only_connectors_and_a_period_is_a_connector_baseline() {
    let mut row = set("(b) ", 90.0, 590.0, Style::default());
    row.extend(set("+", 110.0, 590.0, maths()));
    row.extend(set(" + ", 115.0, 590.0, Style::default()));
    row.extend(set(".", 130.0, 590.0, Style::default()));

    let (connectors, trailing_period) =
        connector_baseline(&row).expect("expected a connector baseline");
    assert_eq!(connectors, ['+', '+']);
    assert!(trailing_period);
    assert_eq!(baseline_label(&row), "(b) ");
}

#[test]
fn a_baseline_with_no_label_still_reads_its_connectors() {
    let row = set("- +", 90.0, 590.0, maths());
    let (connectors, trailing_period) =
        connector_baseline(&row).expect("expected a connector baseline");
    assert_eq!(connectors, ['-', '+']);
    assert!(!trailing_period);
    assert_eq!(baseline_label(&row), "");
}

// Found on Analysis_1_Blatt2_2025.pdf: pdfium places the "+" right after
// "(b)" with a cursor jump and no actual space character in between — so a
// row built with no literal whitespace glyph between ")" and its content
// still has to produce a label ending in exactly one space. `list_marker`'s
// own length calculation always counts the separator after an enumeration
// label as exactly one character, so `baseline_label` disagreeing with that
// by even one character shifts `strip_leading_chars` into eating the start
// of whatever comes right after the label.
#[test]
fn a_label_with_no_literal_space_before_its_content_still_gets_one() {
    let mut row = set("(b)", 90.0, 590.0, Style::default());
    row.extend(set("+", 101.3, 590.0, maths())); // no space CharBox at all
    assert_eq!(baseline_label(&row), "(b) ");
}

#[test]
fn a_row_with_only_a_trailing_period_is_not_a_connector_baseline() {
    // The shape a single (already-handled) fraction's baseline takes:
    // "(a) ." with no connectors at all.
    let row = set("(a) .", 90.0, 590.0, Style::default());
    assert_eq!(connector_baseline(&row), None);
}

#[test]
fn ordinary_prose_is_not_a_connector_baseline() {
    let row = set("(a) some words here", 90.0, 590.0, Style::default());
    assert_eq!(connector_baseline(&row), None);
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

// Found on a real document: a generated space's own x can land inside the
// following letter's advance box rather than between the two words it
// separates. Sorting by that x then read "wird jeweils" as "wirdj eweils" —
// the "j" sorted ahead of the space meant to precede it. Characters are
// ordered by their position in the page's own extraction stream instead,
// which pdfium never gets wrong regardless of what a synthetic glyph's own
// coordinate says.
#[test]
fn a_space_with_a_misleading_x_still_lands_between_its_words() {
    let mut chars = set("wird", 259.261, 627.256, Style::default());
    // A real, zero-width space character, whose x sits inside where "j" is
    // about to be drawn — this is what a synthetic space is not guaranteed
    // to avoid.
    chars.push(CharBox {
        ch: ' ',
        x: 285.251,
        width: 0.0,
        ..chars[0]
    });
    chars.extend(set("jeweils", 284.653, 627.256, Style::default()));

    let lines = group_lines(&chars);

    assert_eq!(lines[0].text(), "wird jeweils", "got: {:?}", lines[0].text());
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
    // Built in plausible PDF stream order: a generator draws the accent right
    // after the letter it sits over, not appended once the whole word (and
    // whatever follows it) is done — confirmed against a real document, where
    // the diaeresis for "Analysis" landed immediately after the letter it
    // marks, not at the end of the run.
    let body = Style { size: 12.0, ..Style::default() };
    let mut chars = set("abzuscha", 111.7, 495.73, body);
    // The umlaut, at exactly the x of the second "a" it sits over — an accent
    // shares its letter's position rather than following it.
    let second_a = 111.7 + 7.0 * 12.0 * ADVANCE;
    chars.extend(set("\u{00A8}", second_a, 495.26, body));
    chars.extend(set("tzen", 111.7 + 8.0 * 12.0 * ADVANCE, 495.73, body));
    chars.extend(set("1", 179.1, 500.0, Style { size: 8.0, ..Style::default() }));

    let lines = group_lines(&chars);

    assert_eq!(lines.len(), 1, "expected one line, got {lines:?}");
    assert!(lines[0].text().contains("abzuschätzen"), "got: {}", lines[0].text());
}

// Found against a second real document (Ue14.pdf): this producer draws the
// accent *before* the vowel it decorates ("l", diaeresis, "o" for "lösen")
// rather than after it, the reverse of
// `a_standalone_accent_glyph_recomposes_with_its_letter`. Stream order can't
// tell the two producers apart; only x-proximity to the accent's own glyph
// can, since it always sits at its vowel's position regardless of which side
// it was drawn from. Coordinates are the real ones read off that document.
#[test]
fn a_standalone_accent_before_its_letter_recomposes_forward() {
    let body = Style { size: 12.0, ..Style::default() };
    let mut chars = set("l", 85.04, 623.06, body);
    chars.extend(set("\u{00A8}", 87.71, 622.58, body));
    chars.extend(set("osen", 87.83, 623.06, body));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("lösen"), "got: {markdown}");
}

#[test]
fn an_accent_with_no_letter_before_it_is_left_alone() {
    let markdown = chars_to_markdown(&page(&["\u{00A8} alone on the line"]));
    assert!(markdown.contains('\u{00A8}'), "got: {markdown}");
}

// Found against Analysis_2_Blatt1_2026.pdf: the diaeresis for "Übungsblatt"
// — a heading, not body text — arrives *eleven* characters after the whole
// word in stream order, immediately before the next line's own "1." list
// marker, rather than next to the "U" it sits over on either side. Real
// coordinates: "U" at x=69.700, the accent at x=71.161 — 1.46pt apart, well
// within the same tolerance every other accent test in this file uses, but
// nowhere near an immediate stream neighbour of it.
#[test]
fn a_heading_accent_deferred_far_past_its_word_still_finds_its_letter() {
    let body = Style { size: 11.96, ..Style::default() };
    let mut chars = set("Ubungsblatt", 69.700, 739.092, body);
    chars.extend(set("\u{00A8}", 71.161, 741.643, body));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("Übungsblatt"), "got: {markdown:?}");
}

// Found against Analysis_2_Blatt12.pdf: pdfium reports the "ff" ligature of
// "Differentialgleichung" as a real, body-sized glyph with no usable Unicode
// value (extract.rs replaces it with U+FFFD rather than dropping it — see
// the comment there for why dropping is unsafe). This is the consequence
// that actually matters at this layer: whatever extract.rs hands over for an
// unrepresentable glyph must keep its geometric slot in the row, or the gap
// where a real character used to be reads as a word boundary and
// "Differentialgleichung" silently becomes the two plausible-looking words
// "Di erentialgleichung" — a worse failure than an ugly placeholder, because
// nothing about it looks broken.
#[test]
fn an_unrepresentable_glyph_stays_inside_its_word_not_a_false_space() {
    let markdown = chars_to_markdown(&page(&["Di\u{FFFD}erentialgleichung"]));
    assert!(
        markdown.contains("Di\u{FFFD}erentialgleichung"),
        "an undecodable mid-word glyph must not read as a word break: got {markdown:?}"
    );
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

// An equation arrives as glyph runs in maths fonts, and read as flat text it is
// confident nonsense. These check it comes back as LaTeX — text, so it can be
// copied into a prompt and edited, which an image could never be.
#[test]
fn a_line_that_is_all_maths_becomes_a_display_equation() {
    let mut chars = page(&["Consider the following identity."]);
    chars.extend(set("f(x) = 1", 200.0, 660.0, maths()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("$$f(x) = 1$$"), "got: {markdown}");
}

#[test]
fn maths_inside_a_sentence_stays_inline() {
    let mut chars = set("Sei ", 72.0, 700.0, Style::default());
    chars.extend(set("f", 72.0 + 4.0 * 5.0, 700.0, maths_italic()));
    chars.extend(set(" gegeben und stetig", 72.0 + 5.0 * 5.0, 700.0, Style::default()));

    assert_eq!(chars_to_markdown(&chars), "Sei $f$ gegeben und stetig\n");
}

// "f : R² → R" sets the colon and the exponent in the body font, so a region
// has to absorb what sits between two maths glyphs.
#[test]
fn a_region_bridges_body_font_characters_inside_an_equation() {
    let mut chars = set("f", 200.0, 700.0, maths_italic());
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

// Found on a real sheet: growing outward can leave two regions at
// *consecutive array indices* with nothing between them — but that says
// nothing about the actual page distance between the characters on either
// side. "f(z) =" and "." are ~100pt apart on a baseline that has nothing in
// between at all, because a fraction's numerator and denominator sit on
// entirely different rows — yet index-adjacency alone was merging them into
// one region spanning that empty column, corrupting exactly the seam a
// fraction later needs to splice into.
#[test]
fn regions_separated_by_a_wide_gap_do_not_merge_just_because_nothing_sits_between_them() {
    let mut chars = set("f(z) =", 200.0, 700.0, maths_italic());
    // Far to the right — nothing else on this row at all, the shape a
    // baseline takes when its fraction lives on other rows entirely.
    chars.extend(set(".", 300.0, 700.0, maths_italic()));

    let lines = group_lines(&chars);

    let regions: Vec<_> = lines[0]
        .content
        .iter()
        .filter(|i| matches!(i, Inline::Maths(_)))
        .collect();
    assert_eq!(regions.len(), 2, "wide gap merged into one region: {:?}", lines[0].content);
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

// Found on Assignment10_DA.pdf: "O(m log n)" set "log" directly against the
// variable "n" with *no* space glyph between them at all — TeX's own
// math-mode inter-atom spacing can be zero, unlike a real word gap. A
// boundary check keyed on "is the next character non-alphabetic" (right for
// telling "cos" apart from "cosh") wrongly rejects this too; only the font
// family actually distinguishes them, since "n" is the maths-italic
// variable face, not a continuation of "log"'s own upright word.
#[test]
fn an_operator_name_touching_its_variable_with_no_space_is_still_absorbed() {
    let mut chars = set("O(m", 200.0, 700.0, maths_italic());
    chars.extend(set("log", 215.0, 700.0, Style::default()));
    // Directly against "log" — zero gap, the case that broke.
    chars.extend(set("n)", 230.0, 700.0, maths_italic()));

    let lines = group_lines(&chars);

    let regions: Vec<_> = lines[0]
        .content
        .iter()
        .filter(|i| matches!(i, Inline::Maths(_)))
        .collect();
    assert_eq!(regions.len(), 1, "expected one region, got {:?}", lines[0].content);
    if let Inline::Maths(latex) = regions[0] {
        assert!(latex.contains("\\log"), "got: {latex}");
    }
}

// Found on Assignment10_DA.pdf: two single-letter maths variables close
// enough in x for `MATHS_BRIDGE_EMS` to bridge — but the word sitting
// between them is ordinary prose ("to"), not an operator name, and must
// stay outside both regions: "paths from s to t" is prose with two
// one-letter equations in it, not one equation reading "s \mathrm{to} t".
#[test]
fn an_ordinary_word_between_two_maths_variables_is_not_absorbed_as_an_operator() {
    let mut chars = set("s", 200.0, 700.0, maths_italic());
    chars.extend(set(" to ", 205.0, 700.0, Style::default()));
    chars.extend(set("t", 225.0, 700.0, maths_italic()));

    let lines = group_lines(&chars);

    let regions: Vec<_> = lines[0]
        .content
        .iter()
        .filter(|i| matches!(i, Inline::Maths(_)))
        .collect();
    assert_eq!(regions.len(), 2, "\"to\" was absorbed into the equation: {:?}", lines[0].content);
    assert!(lines[0].text().contains(" to "), "got: {}", lines[0].text());
}

#[test]
fn a_page_with_no_maths_produces_no_dollar_signs() {
    let markdown = chars_to_markdown(&page(&["just ordinary prose here"]));
    assert!(!markdown.contains('$'), "got: {markdown}");
}

// Found on a real sheet: "T2(3.02,3.99)." was followed immediately by a raised
// footnote-call digit with no gap, and region growth pulled it in as a
// spurious "^3" on the equation. A footnote marker is geometrically identical
// to a real exponent — raised, reduced size — except for what it follows: an
// exponent never sits directly after a full stop.
#[test]
fn a_footnote_marker_after_an_equation_does_not_bleed_into_it() {
    let mut chars = set("siehe die Gleichung", 72.0, 700.0, Style::default());
    chars.extend(set("T", 72.0 + 21.0 * 5.0, 700.0, maths_italic()));
    chars.extend(set(".", 72.0 + 22.0 * 5.0, 700.0, Style::default()));
    // The footnote call: smaller, raised, glued to the period with no gap.
    chars.extend(set(
        "3",
        72.0 + 22.0 * 5.0 + 5.0,
        704.0,
        Style { size: BODY * 0.7, ..Style::default() },
    ));

    let markdown = chars_to_markdown(&chars);

    assert!(!markdown.contains("^3"), "footnote leaked into the equation: {markdown}");
    // The footnote digit itself must survive as ordinary trailing text, not
    // vanish — it is the mark a reader follows to the footnote.
    assert!(markdown.trim_end().ends_with('3'), "footnote digit lost: {markdown}");
}

// Found on a real sheet: "(a) C ist der Kreis..." (an enumeration label
// immediately before a lone mathcal variable, with no space wide enough to
// stop the ordinary gap check) absorbed the label's closing paren into the
// equation, reading "(a$) C$ ist" instead of "(a) $C$ ist". Growing backward
// must never cross a ')' at all — it always belongs to some other,
// already-closed bracketed group, never to the equation being grown.
#[test]
fn an_enumeration_labels_closing_paren_does_not_leak_into_a_following_equation() {
    let mut chars = set("(a)", 90.9, 700.0, Style::default());
    chars.extend(set("C", 111.7, 700.0, maths()));
    chars.extend(set(" ist der Kreis", 118.1, 700.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("$C$"), "got: {markdown}");
    assert!(!markdown.contains(")$"), "closing paren leaked into the region: {markdown}");
}

// Found on a real sheet: a fraction's numerator sits on its own row, with its
// own exponent one script-tolerance window above that — and a big operator (a
// contour integral, ∮) drawn just to the left can easily sort closer in `y` to
// that exponent than the exponent's own base character does. The old
// sequential-anchor rule attached the exponent to whichever row was open when
// it was scanned, which read "z2 + 5" as a bare "2" stuck to the operator
// instead of "z^2 + 5".
#[test]
fn an_exponent_attaches_to_its_own_base_row_not_a_nearby_tall_symbol() {
    // The big operator: tall, positioned to the left, well above the
    // numerator's own baseline — the shape a display-style ∮ actually takes.
    let mut oint = set("∮", 268.0, 676.24, extensible());
    if let Some(c) = oint.first_mut() {
        c.top = 676.72;
        c.bottom = 649.68;
    }
    let mut chars = oint;
    // The numerator base. Built in the order a real content stream draws it
    // — the exponent immediately after "z", before "+ 5" — since build_line
    // orders a row by stream position, not by x.
    chars.extend(set("z", 296.78, 668.05, maths_italic()));
    // The exponent: script-sized, positioned just above and right of "z",
    // closer in y to the operator above than to "z" below it — the trap.
    chars.push(CharBox {
        ch: '2',
        x: 302.75,
        y: 672.39,
        width: 4.23,
        top: 676.0,
        bottom: 670.0,
        font_size: BODY * 0.7,
        family: Family::Text,
        ..chars[chars.len() - 1]
    });
    chars.extend(set("+", 310.14, 668.05, Style::default()));
    chars.extend(set("5", 321.89, 668.05, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("z^2"), "exponent lost its base: {markdown}");
    assert!(!markdown.contains("∮^2") && !markdown.contains("oint}^2"), "got: {markdown}");
}

// The other half of the same real bug: the operator's *own* subscript sits at
// the foot of its glyph, which for a tall symbol like ∮ is far below its own
// baseline — well outside any tolerance scaled from a normal single-line
// offset. It has to be found from the operator's own measured height instead.
#[test]
fn a_subscript_far_below_a_tall_operator_still_attaches_to_it() {
    // Establishes BODY as the page's dominant size — a real page always has
    // plenty of body text elsewhere; without it, a 2-character fixture has no
    // way to tell body text from a script by count alone.
    let mut chars = page(&["ordinary body text surrounding the equation"]);
    let mut oint = set("∮", 268.33, 676.24, extensible());
    if let Some(c) = oint.first_mut() {
        c.top = 676.72;
        c.bottom = 649.68;
    }
    chars.extend(oint);
    chars.push(CharBox {
        ch: 'C',
        x: 274.97,
        y: 649.17,
        width: 4.49,
        top: 655.15,
        bottom: 647.62,
        font_size: BODY * 0.7,
        family: Family::Script,
        ..chars[chars.len() - 1]
    });

    let lines = group_lines(&chars);

    // The body-text paragraph is its own line; the operator and its subscript
    // together are the second. Three would mean the subscript split off on
    // its own instead of joining the operator's row.
    assert_eq!(lines.len(), 2, "the subscript split off into its own line: {lines:?}");
    assert!(
        lines[1].content.iter().any(|i| matches!(i, Inline::Maths(s) if s.contains("mathcal{C}"))),
        "subscript missing from the operator's line: {:?}",
        lines[1].content
    );
}

// LaTeX's fraction bar is a drawn rule, invisible to the text layer, so a
// numerator and denominator arrive as separate lines with nothing connecting
// them. Found on a real sheet and reconstructed from geometry alone: vertical
// stacking plus horizontal column overlap between two single-region maths
// lines.
#[test]
fn a_numerator_and_denominator_on_separate_lines_become_one_fraction() {
    let mut chars = set("a + b", 300.0, 700.0, maths_italic());
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains(r"\frac{a + b}{c + d}"), "got: {markdown}");
}

// Trailing content beside a fraction ("dz" after an integral) sits close to
// the fraction's own column and can extend past its right edge — but it
// never *starts* before the fraction the way a real baseline prefix
// ("f(z) =") does. Found reversed on a real sheet: "dz" was landing before
// the fraction instead of after it, because the first version of this check
// treated "extends past either edge" as evidence of being a baseline,
// when only "starts before the left edge" actually is.
#[test]
fn trailing_content_beside_a_fraction_stays_after_it_not_before() {
    let mut chars = set("a + b", 300.0, 700.0, maths_italic());
    // Sits mostly to the right of the fraction's own column, its right edge
    // extending a little past it — the shape "dz" takes beside a fraction.
    chars.extend(set("dz", 340.0, 690.0, maths_italic()));
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains(r"\frac{a + b}{c + d} dz"), "got: {markdown}");
}

// The baseline-splitting pattern in `regions_separated_by_a_wide_gap_...`
// above ("f(z) =" and "." as two regions on one line) also makes that line
// read as `is_display_maths` — all its non-maths content is whitespace. That
// alone is not enough to rule it out as a fraction's other half: found on a
// real sheet pairing a numerator with this baseline instead of the real
// denominator below it, since the baseline sat closer in `y`. A genuine
// numerator or denominator is a *single* unbroken region; a baseline like
// this is not, and that is the distinction that has to decide it.
#[test]
fn a_baseline_shaped_line_is_never_mistaken_for_the_other_half_of_a_fraction() {
    // Ordinary paragraph text elsewhere, so the paragraph-break check that
    // scopes fraction pairing to one paragraph has more than two gaps to
    // measure a "normal" line spacing from — with only the three lines of
    // the fraction itself, a median of two samples is unstable and the check
    // misfires on this fixture in a way a real page never gives it the
    // chance to.
    let mut chars = page_at(900.0, &["ordinary paragraph text", "with a normal line spacing"]);
    chars.extend(set("a + b", 300.0, 700.0, maths_italic()));
    // Closer to the numerator than the real denominator is, and — because of
    // the wide gap between "f(z) =" and "." — reads as is_display_maths, the
    // same as a genuine numerator or denominator would.
    chars.extend(set("f(z) =", 250.0, 693.0, maths_italic()));
    chars.extend(set(".", 340.0, 693.0, maths_italic()));
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains(r"\frac{a + b}{c + d}"), "got: {markdown}");
    assert!(!markdown.contains(r"\frac{a + b}{f(z) ="), "paired with the baseline instead: {markdown}");
}

// Reconstructs the shape exercise 1(b) on Analysis_1_Blatt2_2025.pdf takes:
// three fractions summed, one numerator row, one denominator row, joined by
// "+"/"-" on the baseline in between. `render_content` wraps every
// `Inline::Maths` as `$latex$` with nothing added around it (verified by
// reading `render_content` directly), so the exact expected markdown is
// spelled out below rather than guessed at.
#[test]
fn a_sum_of_three_stacked_fractions_becomes_three_fracs() {
    // Numerators: "p", "q", "r" — three single terms with a generous, equal
    // gap between them.
    let mut chars = set("p", 115.0, 599.0, maths_italic());
    chars.extend(set("q", 145.0, 599.0, maths_italic()));
    chars.extend(set("r", 175.0, 599.0, maths_italic()));

    // Baseline: "(b) " + "+" + "+" + "." — two connectors, so three terms.
    chars.extend(set("(b) ", 90.0, 591.0, Style::default()));
    chars.extend(set("+", 118.0, 591.0, maths()));
    chars.extend(set("+", 148.0, 591.0, maths()));
    chars.extend(set(".", 205.0, 591.0, Style::default()));

    // Denominators: "s", "t+u", "v-w" — wider terms sitting closer together
    // than the numerators above them, the exact geometry that made the old
    // single-gap-threshold bridging glue all three denominators into one
    // string.
    chars.extend(set("s", 113.0, 583.0, maths_italic()));
    chars.extend(set("t+u", 123.0, 583.0, maths_italic()));
    chars.extend(set("v-w", 148.0, 583.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    // "(b) " itself is consumed by the pipeline's pre-existing "(a)"-style
    // list-marker stripping (`list_marker`/`strip_leading_chars` in this
    // same file) once this line reaches `group_blocks` — same as it already
    // would for an ordinary, non-fraction "(b) ..." list item — so it's not
    // part of what this test is checking. What matters here is that the
    // three fractions came out right and stayed joined by their connectors
    // in the correct left-to-right order.
    assert!(
        markdown.contains("$\\frac{p}{s}$ + $\\frac{q}{t+u}$ + $\\frac{r}{v-w}$."),
        "got: {markdown}"
    );
}

// A single fraction (no connectors on its baseline) must keep going through
// the existing `reconstruct_fractions` path unchanged — this pass only
// engages once there's at least one connector.
#[test]
fn a_single_fraction_is_left_to_the_existing_reconstruction() {
    let mut chars = set("a + b", 300.0, 700.0, maths_italic());
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains(r"\frac{a + b}{c + d}"), "got: {markdown}");
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

fn table_row_line(cells: Vec<Vec<Inline>>) -> Line {
    Line {
        content: vec![Inline::TableRow(cells)],
        x: 72.0,
        right: 200.0,
        y: 700.0,
        font_size: BODY,
        fixed_pitch: false,
        is_display_maths: false,
        ends_hyphenated: false,
    }
}

#[test]
fn a_table_row_line_is_not_blank() {
    let line = table_row_line(vec![
        vec![Inline::Text(Span { text: "a".into(), bold: false, italic: false })],
        vec![Inline::Text(Span { text: "b".into(), bold: false, italic: false })],
    ]);
    assert!(!line.is_blank());
}

#[test]
fn a_table_row_lines_own_text_is_empty() {
    let line = table_row_line(vec![vec![Inline::Text(Span {
        text: "cell".into(),
        bold: false,
        italic: false,
    })]]);
    assert_eq!(line.text(), "");
}
