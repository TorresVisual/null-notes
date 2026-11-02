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

/// Builds one `CharBox` from exact captured geometry (`dump_chars_range`),
/// width included — unlike `set()`, which gives every glyph in a call the
/// same synthetic `size * ADVANCE` width. Some tests (`split_into_terms`'s
/// gap-ratio margin, in particular) are sensitive to real width variation
/// that a uniform approximation doesn't reproduce.
fn real_char(c: char, x: f32, w: f32, y: f32, size: f32, family: Family) -> CharBox {
    CharBox {
        ch: c,
        x,
        y,
        width: w,
        top: y + size * 0.75,
        bottom: y - size * 0.25,
        font_size: size,
        bold: false,
        italic: false,
        fixed_pitch: false,
        family,
    }
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
    let texts: Vec<String> = groups
        .iter()
        .map(|g| g.iter().map(|c| c.ch).collect())
        .collect();
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
    assert_eq!(
        groups[0].len(),
        row.iter().filter(|c| !c.ch.is_whitespace()).count()
    );
}

// "für t ≥ b" — a German connector word followed by a maths comparison, the
// shape a piecewise condition takes. "für" needs \text{} (it is prose, not
// a maths variable a bare `f`, `ü`, `r` triplet would garble into); "t \geq
// b" needs none. Each gap here (100 * ADVANCE = 5.0pt at this BODY size) is
// comfortably past both `render_condition`'s own SPACE_GAP threshold and
// `to_latex`'s internal one, so every one becomes one literal space in the
// output — not zero, not two.
#[test]
fn a_condition_wraps_its_prose_word_but_leaves_the_maths_bare() {
    let mut chars = set("für", 100.0, 700.0, Style::default());
    chars.extend(set("t", 120.0, 700.0, maths_italic()));
    chars.extend(set("\u{2265}", 130.0, 700.0, maths()));
    chars.extend(set("b", 140.0, 700.0, maths_italic()));

    assert_eq!(render_condition(&chars), r"\text{für} t \geq b");
}

// A condition with no prose at all (an English-language document might set
// "if" upright in the maths face already, leaving nothing that needs
// \text{}) still renders through cleanly.
#[test]
fn a_purely_mathematical_condition_needs_no_text_wrapping() {
    let chars = set("t=0", 100.0, 700.0, maths_italic());
    assert_eq!(render_condition(&chars), "t=0");
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

// The plain shape (Analysis_2_Blatt11.pdf item 6): a row holding nothing
// but the open and close bracket glyphs, with real whitespace between them
// (the gap the matrix's own content will occupy).
#[test]
fn a_bare_bracket_pair_row_has_no_leading_text() {
    let mut row = set("\u{12}", 274.383, 757.389, extensible());
    row.extend(set(" ", 283.183, 757.389, Style::default()));
    row.extend(set("\u{13}", 385.085, 757.389, extensible()));

    let (brackets, leading) = matrix_bracket_row(&row).expect("expected a bracket-pair row");
    assert_eq!(brackets.len(), 1);
    assert_eq!(brackets[0].0.ch, '\u{12}');
    assert_eq!(brackets[0].1.ch, '\u{13}');
    assert!(leading.is_empty());
}

// The Analysis_2_Blatt5_2026.pdf item 3 shape: the bracket row also carries
// the sentence's own leading prose ahead of the open bracket.
#[test]
fn a_bracket_pair_row_keeps_its_leading_prose() {
    let mut row = set(
        "3. Gegeben ist das Vektorfeld ",
        71.00,
        211.34,
        Style::default(),
    );
    row.extend(set("\u{12}", 320.53, 211.34, extensible()));
    row.extend(set(" ", 329.33, 211.34, Style::default()));
    row.extend(set("\u{13}", 347.32, 211.34, extensible()));

    let (brackets, leading) = matrix_bracket_row(&row).expect("expected a bracket-pair row");
    assert_eq!(brackets.len(), 1);
    assert_eq!(brackets[0].0.ch, '\u{12}');
    assert_eq!(brackets[0].1.ch, '\u{13}');
    let leading_text: String = leading.iter().map(|c| c.ch).collect();
    assert_eq!(leading_text, "3. Gegeben ist das Vektorfeld ");
}

// A row with real content between the open and close bracket (an ordinary
// inline parenthesized expression, not a matrix's own dedicated bracket
// row) must not match — that shape already renders correctly today via
// per-row maths handling and this pass must leave it alone.
#[test]
fn a_row_with_content_between_the_brackets_is_not_a_bracket_pair_row() {
    let mut row = set("\u{12}", 100.0, 700.0, extensible());
    row.extend(set("x + y", 110.0, 700.0, maths_italic()));
    row.extend(set("\u{13}", 160.0, 700.0, extensible()));

    assert_eq!(matrix_bracket_row(&row), None);
}

// A row with only one bracket glyph (no matching partner) is not a
// bracket-pair row — the shape `reconstruct_cases`'s own single-glyph brace
// row takes, which this predicate must not also match.
#[test]
fn a_row_with_only_one_bracket_glyph_is_not_a_bracket_pair_row() {
    let row = set("\u{12}", 100.0, 700.0, extensible());
    assert_eq!(matrix_bracket_row(&row), None);
}

// Analysis_2_Blatt12.pdf items 4/5: several independent small matrices
// share one bracket row, separated only by spaces.
#[test]
fn a_row_with_two_bracket_pairs_is_recognized() {
    let mut row = set("\u{12}", 219.397, 220.271, extensible());
    row.extend(set(" ", 228.0, 220.271, Style::default()));
    row.extend(set("\u{13}", 249.866, 220.271, extensible()));
    row.extend(set(" ", 258.0, 220.271, Style::default()));
    row.extend(set("\u{12}", 294.546, 220.271, extensible()));
    row.extend(set(" ", 303.0, 220.271, Style::default()));
    row.extend(set("\u{13}", 316.562, 220.271, extensible()));

    let (brackets, leading) = matrix_bracket_row(&row).expect("expected a bracket-pair row");
    assert_eq!(brackets.len(), 2);
    assert_eq!(brackets[0].0.ch, '\u{12}');
    assert_eq!(brackets[0].1.ch, '\u{13}');
    assert_eq!(brackets[1].0.ch, '\u{12}');
    assert_eq!(brackets[1].1.ch, '\u{13}');
    assert!(leading.is_empty());
}

// Real content strictly *between* two bracket pairs (not just within one
// pair) must also reject the row — the same reasoning
// `a_row_with_content_between_the_brackets_is_not_a_bracket_pair_row`
// already establishes for content within one pair.
#[test]
fn a_row_with_content_between_two_bracket_pairs_is_not_a_bracket_pair_row() {
    let mut row = set("\u{12}", 100.0, 700.0, extensible());
    row.extend(set("\u{13}", 120.0, 700.0, extensible()));
    row.extend(set("x", 130.0, 700.0, maths_italic()));
    row.extend(set("\u{12}", 150.0, 700.0, extensible()));
    row.extend(set("\u{13}", 170.0, 700.0, extensible()));

    assert_eq!(matrix_bracket_row(&row), None);
}

// Reconstructs Analysis_2_Blatt12.pdf's Heaviside step function definition:
// a leading word ("ist ") sharing the brace glyph's own row, a prefix
// ("H(t-b) ="), and two cases each split into a value and a "für
// <condition>" half. The prefix row's own y (331.49) sits *between* the two
// case rows (338.81 and 324.37) — TeX centers "H(t-b) =" vertically against
// the whole two-line cases block — which is exactly the shape that broke
// every reconstruction pass that assumed a prefix always precedes its
// content in `y`.
//
// Real per-character geometry throughout (`dump_chars_range` on
// Analysis_2_Blatt12.pdf), not the file's `set()` helper: `set()` gives
// every glyph in one call the same synthetic width (`size * ADVANCE`), but
// `split_into_terms`'s value/condition split depends on the *real*
// gap-width ratios between "1"/"0" and "für" being clearly wider than any
// gap inside "für t ≥ b" itself — an artificial uniform width doesn't
// reproduce that margin, and the split would fail for a reason that has
// nothing to do with `reconstruct_cases` itself.
#[test]
fn a_heaviside_style_cases_block_becomes_one_display_equation() {
    use real_char as real;

    // Prefix: "H(t-b) =" — already one clean maths run on its own row.
    let mut chars = vec![
        real('H', 241.289, 10.258, 331.491, 11.96, Family::Italic),
        real('(', 251.912, 4.543, 331.491, 11.96, Family::Text),
        real('t', 256.464, 4.220, 331.491, 11.96, Family::Italic),
        real('\u{2212}', 263.348, 9.289, 331.491, 11.96, Family::Symbol),
        real('b', 275.303, 4.973, 331.491, 11.96, Family::Italic),
        real(')', 280.280, 4.543, 331.491, 11.96, Family::Text),
        real('=', 288.146, 9.098, 331.491, 11.96, Family::Text),
    ];

    // The brace's own row: "ist" (the word introducing the definition,
    // body-sized like the brace itself, so it shares its row the normal
    // way any two same-baseline body-text characters would — even though,
    // as on the real document, it sits far to this row's left while the
    // brace itself sits far to its right) then the CMEX glyph, above both
    // cases.
    chars.extend([
        real('i', 85.958, 3.252, 349.921, 11.96, Family::Text),
        real('s', 89.210, 4.615, 349.921, 11.96, Family::Text),
        real('t', 93.825, 4.555, 349.921, 11.96, Family::Text),
        real('\u{1a}', 300.579, 8.966, 348.347, 11.96, Family::Extensible),
    ]);

    // First case: "1 für t ≥ b" — value, then condition, at y=338.813.
    chars.extend([
        real('1', 314.527, 5.846, 338.813, 11.96, Family::Text),
        real('f', 330.342, 4.316, 338.813, 11.96, Family::Text),
        real('ü', 333.917, 6.504, 338.813, 11.96, Family::Text),
        real('r', 340.420, 4.555, 338.813, 11.96, Family::Text),
        real('t', 348.872, 4.220, 338.813, 11.96, Family::Italic),
        real('\u{2265}', 356.420, 9.289, 338.813, 11.96, Family::Symbol),
        real('b', 369.040, 4.973, 338.813, 11.96, Family::Italic),
    ]);

    // Second case: "0 für t < b." — value, then condition, at y=324.367.
    chars.extend([
        real('0', 314.527, 5.846, 324.367, 11.96, Family::Text),
        real('f', 330.342, 4.316, 324.367, 11.96, Family::Text),
        real('ü', 333.917, 6.504, 324.367, 11.96, Family::Text),
        real('r', 340.420, 4.555, 324.367, 11.96, Family::Text),
        real('t', 348.872, 4.220, 324.367, 11.96, Family::Italic),
        real('<', 356.416, 9.098, 324.367, 11.96, Family::Italic),
        real('b', 368.837, 4.973, 324.367, 11.96, Family::Italic),
        real('.', 373.811, 3.252, 324.367, 11.96, Family::Italic),
    ]);

    let markdown = chars_to_markdown(&chars);

    // "H(t - b) =", spaces and all: the same gap-synthesis threshold
    // `to_latex` always applies decides these particular gaps (2.66pt,
    // just over the 2.63pt `SPACE_GAP` cutoff at this size) are word-spaces
    // — matching the real document's own `dump_line_pieces` output for
    // this exact prefix, `Maths("H(t - b) =")`, not a hand-picked
    // convenience.
    assert!(
        markdown.contains(
            r"ist $H(t - b) = \begin{cases} 1 & \text{für} t \geq b \\ 0 & \text{für} t < b. \end{cases}$"
        ),
        "got: {markdown}"
    );
}

// Reconstructs Analysis_2_Blatt11.pdf item 6's real vector field:
// `⃗v(x, y) = (3x² − 3y² + 2x + 2y, −6xy + 2x − 2y).` — a bracket row with
// no leading text, two single-column content rows, and a prefix row
// ("⃗v(x, y) =" ... ".") whose own `y` sits *between* the two content
// rows — TeX centers it vertically against the whole bracket, the same
// quirk `reconstruct_cases` already solved for `H(t-b) =`.
#[test]
fn a_two_row_vector_becomes_one_pmatrix() {
    use real_char as real;

    let chars = vec![
        // "⃗v(x, y) =" — prefix, before the bracket.
        real('\u{20d7}', 224.934, 7.364, 740.532, 11.96, Family::Italic),
        real('v', 225.400, 5.655, 740.532, 11.96, Family::Italic),
        real('(', 231.499, 4.543, 740.532, 11.96, Family::Text),
        real('x', 236.051, 6.647, 740.532, 11.96, Family::Italic),
        real(',', 242.698, 3.252, 740.532, 11.96, Family::Italic),
        real(' ', 247.946, 0.000, 740.532, 11.96, Family::Italic),
        real('y', 247.946, 5.715, 740.532, 11.96, Family::Italic),
        real(')', 254.084, 4.543, 740.532, 11.96, Family::Text),
        real(' ', 261.951, 0.000, 740.532, 11.96, Family::Text),
        real('=', 261.951, 9.098, 740.532, 11.96, Family::Text),
        // The bracket row: open paren above the first content row's y.
        real('\u{12}', 274.383, 8.799, 757.389, 11.96, Family::Extensible),
        // First content row: "3x^2 - 3y^2 + 2x + 2y".
        real('3', 283.183, 5.846, 747.854, 11.96, Family::Text),
        real('x', 289.036, 6.647, 747.854, 11.96, Family::Italic),
        real('2', 295.688, 4.232, 752.193, 7.97, Family::Text),
        real('\u{2212}', 303.077, 9.289, 747.854, 11.96, Family::Symbol),
        real('3', 315.032, 5.846, 747.854, 11.96, Family::Text),
        real('y', 320.885, 5.715, 747.854, 11.96, Family::Italic),
        real('2', 327.022, 4.232, 752.193, 7.97, Family::Text),
        real('+', 334.411, 9.098, 747.854, 11.96, Family::Text),
        real(' ', 346.163, 0.000, 747.854, 11.96, Family::Text),
        real('2', 346.163, 5.846, 747.854, 11.96, Family::Text),
        real('x', 352.025, 6.647, 747.854, 11.96, Family::Italic),
        real('+', 361.334, 9.098, 747.854, 11.96, Family::Text),
        real(' ', 373.086, 0.000, 747.854, 11.96, Family::Text),
        real('2', 373.086, 5.846, 747.854, 11.96, Family::Text),
        real('y', 378.948, 5.715, 747.854, 11.96, Family::Italic),
        // Second content row: "-6xy + 2x - 2y".
        real('\u{2212}', 293.402, 9.289, 733.408, 11.96, Family::Symbol),
        real('6', 302.700, 5.846, 733.408, 11.96, Family::Text),
        real('x', 308.553, 6.647, 733.408, 11.96, Family::Italic),
        real('y', 315.200, 5.715, 733.408, 11.96, Family::Italic),
        real('+', 323.999, 9.098, 733.408, 11.96, Family::Text),
        real(' ', 335.751, 0.000, 733.408, 11.96, Family::Text),
        real('2', 335.751, 5.846, 733.408, 11.96, Family::Text),
        real('x', 341.613, 6.647, 733.408, 11.96, Family::Italic),
        real('\u{2212}', 350.922, 9.289, 733.408, 11.96, Family::Symbol),
        real('2', 362.877, 5.846, 733.408, 11.96, Family::Text),
        real('y', 368.730, 5.715, 733.408, 11.96, Family::Italic),
        // Close bracket, and the trailing period after it (same baseline
        // as the prefix row).
        real('\u{13}', 385.085, 8.799, 757.389, 11.96, Family::Extensible),
        real('.', 395.878, 3.252, 740.532, 11.96, Family::Italic),
    ];
    // Row grouping (`group_lines`) buckets by y-proximity, not stream
    // order, so this list's order — prefix, then bracket, then both
    // content rows, then close bracket and trailing period — intentionally
    // mirrors the real document's own stream order rather than needing to
    // be pre-sorted by row.

    let markdown = chars_to_markdown(&chars);

    // A bare `Inline::Maths` line (no leading prose) renders as *display*
    // maths — its own block, `$` on its own line before and after — rather
    // than inline `$...$`; that block formatting is `render_content`'s
    // existing, unrelated concern, so this checks the reconstructed LaTeX
    // content itself rather than assuming a particular `$` placement.
    assert!(
        markdown.contains(
            r"\vec{v}(x, y) = \begin{pmatrix} 3x^2 - 3y^2 + 2x + 2y \\ -6xy + 2x - 2y \end{pmatrix}."
        ),
        "got: {markdown}"
    );
}

// Reconstructs a genuine 2x2 matrix compiled with pdflatex
// (notes/tests/matrix_2x2_test.pdf: `A = \begin{pmatrix} a_{11} & a_{12}
// \\ a_{21} & a_{22} \end{pmatrix}.`) — the only way to verify the N>1
// column path, since no real document in the corpus carries a genuine
// multi-column matrix. Real captured coordinates throughout
// (`dump_chars_range`), for the same reason `a_two_row_vector_becomes_one_pmatrix`
// uses them: column detection depends on the real gap-width proportions
// between the two columns' cells.
#[test]
fn a_two_by_two_matrix_becomes_two_pmatrix_columns() {
    use real_char as real;

    let chars = vec![
        // "A =" — prefix, before the bracket.
        real('A', 261.350, 8.775, 685.705, 11.96, Family::Italic),
        real('=', 273.449, 9.098, 685.705, 11.96, Family::Text),
        // The bracket row: no leading text.
        real('\u{12}', 285.871, 8.799, 702.562, 11.96, Family::Extensible),
        // First content row: "a_{11}  a_{12}".
        real('a', 294.672, 6.145, 693.028, 11.96, Family::Italic),
        real('1', 300.817, 4.232, 691.235, 7.97, Family::Text),
        real('1', 305.049, 4.232, 691.235, 7.97, Family::Text),
        real('a', 319.746, 6.145, 693.028, 11.96, Family::Italic),
        real('1', 325.891, 4.232, 691.235, 7.97, Family::Text),
        real('2', 330.123, 4.232, 691.235, 7.97, Family::Text),
        // Second content row: "a_{21}  a_{22}".
        real('a', 294.672, 6.145, 678.582, 11.96, Family::Italic),
        real('2', 300.817, 4.232, 676.789, 7.97, Family::Text),
        real('1', 305.049, 4.232, 676.789, 7.97, Family::Text),
        real('a', 319.746, 6.145, 678.582, 11.96, Family::Italic),
        real('2', 325.891, 4.232, 676.789, 7.97, Family::Text),
        real('2', 330.123, 4.232, 676.789, 7.97, Family::Text),
        // Close bracket, and the trailing period after it (same baseline
        // as the prefix row).
        real('\u{13}', 334.857, 8.799, 702.562, 11.96, Family::Extensible),
        real('.', 345.650, 3.252, 685.705, 11.96, Family::Italic),
    ];

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains(r"A = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix}."),
        "got: {markdown}"
    );
}

// Reconstructs Analysis_2_Blatt12.pdf item 4's system of equations:
// `⃗y'(t) = Ay(t) + b(t), mit ⃗y(0) = y₀` with `A=[[1,2],[2,1]]`,
// `b(t)=[e^{2t},0]ᵀ`, `y₀=[1,-1]ᵀ` — three independent bracket pairs
// sharing one bracket row, with both content rows holding all three
// matrices'/vectors' values interleaved. Real captured coordinates
// throughout (`dump_chars_range`), same reasoning as every other
// real-document fixture in this file.
#[test]
fn a_system_of_equations_with_three_inline_brackets_becomes_three_pmatrices() {
    use real_char as real;

    let chars = vec![
        // "⃗y'(t) =" — before bracket 1.
        real('\u{20d7}', 181.260, 7.364, 203.414, 11.96, Family::Italic),
        real('y', 181.380, 5.715, 203.414, 11.96, Family::Italic),
        real('′', 187.524, 2.295, 208.350, 7.97, Family::Symbol),
        real('(', 190.319, 4.543, 203.414, 11.96, Family::Text),
        real('t', 194.872, 4.220, 203.414, 11.96, Family::Italic),
        real(')', 199.099, 4.543, 203.414, 11.96, Family::Text),
        real(' ', 206.965, 0.000, 203.414, 11.96, Family::Text),
        real('=', 206.965, 9.098, 203.414, 11.96, Family::Text),
        // Bracket 1 (A).
        real('\u{12}', 219.397, 8.799, 220.271, 11.96, Family::Extensible),
        real('\u{13}', 249.866, 8.799, 220.271, 11.96, Family::Extensible),
        // A's content: row1 "1 2", row2 "2 1".
        real('1', 228.198, 5.846, 210.736, 11.96, Family::Text),
        real('2', 244.003, 5.846, 210.736, 11.96, Family::Text),
        real('2', 228.198, 5.846, 196.291, 11.96, Family::Text),
        real('1', 244.003, 5.846, 196.291, 11.96, Family::Text),
        // "⃗y(t) +" — between bracket 1 and bracket 2.
        real('\u{20d7}', 260.532, 7.364, 203.414, 11.96, Family::Italic),
        real('y', 260.652, 5.715, 203.414, 11.96, Family::Italic),
        real('(', 266.796, 4.543, 203.414, 11.96, Family::Text),
        real('t', 271.348, 4.220, 203.414, 11.96, Family::Italic),
        real(')', 275.575, 4.543, 203.414, 11.96, Family::Text),
        real(' ', 282.772, 0.000, 203.414, 11.96, Family::Text),
        real('+', 282.772, 9.098, 203.414, 11.96, Family::Text),
        // Bracket 2 (b(t)).
        real('\u{12}', 294.546, 8.799, 220.271, 11.96, Family::Extensible),
        real('\u{13}', 316.562, 8.799, 220.271, 11.96, Family::Extensible),
        // b(t)'s content: row1 "e^{2t}", row2 "0".
        real('e', 303.346, 5.416, 210.737, 11.96, Family::Italic),
        real('2', 308.771, 4.232, 215.075, 7.97, Family::Text),
        real('t', 313.006, 3.053, 215.075, 7.97, Family::Italic),
        real('0', 307.027, 5.846, 196.291, 11.96, Family::Text),
        // "mit ⃗y(0) =" — between bracket 2 and bracket 3.
        real('m', 339.058, 9.755, 203.414, 11.96, Family::Text),
        real('i', 348.813, 3.252, 203.414, 11.96, Family::Text),
        real('t', 352.065, 4.555, 203.414, 11.96, Family::Text),
        real('\u{20d7}', 368.189, 7.364, 203.414, 11.96, Family::Italic),
        real('y', 368.309, 5.715, 203.414, 11.96, Family::Italic),
        real('(', 374.453, 4.543, 203.414, 11.96, Family::Text),
        real('0', 378.996, 5.846, 203.414, 11.96, Family::Text),
        real(')', 384.842, 4.543, 203.414, 11.96, Family::Text),
        real(' ', 392.709, 0.000, 203.414, 11.96, Family::Text),
        real('=', 392.709, 9.098, 203.414, 11.96, Family::Text),
        // Bracket 3 (y₀).
        real('\u{12}', 405.157, 8.799, 220.271, 11.96, Family::Extensible),
        real('\u{13}', 429.108, 8.799, 220.271, 11.96, Family::Extensible),
        // y₀'s content: row1 "1", row2 "-1".
        real('1', 418.606, 5.846, 210.737, 11.96, Family::Text),
        real('−', 413.957, 9.289, 196.291, 11.96, Family::Symbol),
        real('1', 423.255, 5.846, 196.291, 11.96, Family::Text),
        // "." — after bracket 3.
        real('.', 439.901, 3.252, 203.414, 11.96, Family::Italic),
    ];

    let markdown = chars_to_markdown(&chars);

    // "mit" renders as `\mathrm{mit}` — existing, unrelated `to_latex`
    // behavior for a short upright-word run, not something this pass
    // controls.
    assert!(
        markdown.contains(
            r"\vec{y}'(t) = \begin{pmatrix} 1 & 2 \\ 2 & 1 \end{pmatrix} \vec{y}(t) + \begin{pmatrix} e^{2t} \\ 0 \end{pmatrix} \mathrm{mit} \vec{y}(0) = \begin{pmatrix} 1 \\ -1 \end{pmatrix}."
        ),
        "got: {markdown}"
    );
}

// Reconstructs Analysis_2_Blatt7_2026.pdf item 1's vector field:
// `⃗v(x, y, z) = \begin{pmatrix} x+y \\ x+2y² \\ yz \end{pmatrix}` — a
// 3-row column vector whose bracket is assembled from two glyph pieces
// per side (a font artifact for this taller pmatrix, not two logical
// brackets). The bottom piece lands glued directly onto the middle row,
// which is *also* this vector's own prefix ("⃗v(x, y, z) =") *and* its
// own second content row ("x + 2y²") — one row serving three roles at
// once. Real captured coordinates throughout (`dump_chars_range`), same
// reasoning as every other real-document fixture in this file.
#[test]
fn an_assembled_delimiter_vector_with_a_fused_prefix_row_becomes_one_pmatrix() {
    use real_char as real;

    let chars = vec![
        // "⃗v(x, y, z) =" — prefix, before the bracket.
        real('\u{20d7}', 252.343, 7.364, 625.258, 11.96, Family::Italic),
        real('v', 252.809, 5.655, 625.258, 11.96, Family::Italic),
        real('(', 258.908, 4.543, 625.258, 11.96, Family::Text),
        real('x', 263.460, 6.647, 625.258, 11.96, Family::Italic),
        real(',', 270.107, 3.252, 625.258, 11.96, Family::Italic),
        real(' ', 275.355, 0.000, 625.258, 11.96, Family::Italic),
        real('y', 275.355, 5.715, 625.258, 11.96, Family::Italic),
        real(',', 281.488, 3.252, 625.258, 11.96, Family::Italic),
        real(' ', 286.725, 0.000, 625.258, 11.96, Family::Italic),
        real('z', 286.725, 5.499, 625.258, 11.96, Family::Italic),
        real(')', 292.708, 4.543, 625.258, 11.96, Family::Text),
        real(' ', 300.574, 0.000, 625.258, 11.96, Family::Text),
        real('=', 300.574, 9.098, 625.258, 11.96, Family::Text),
        // Open bracket, both pieces.
        real(
            '\u{f8eb}',
            313.007,
            10.461,
            649.288,
            11.96,
            Family::Extensible,
        ),
        real(
            '\u{f8ed}',
            313.007,
            10.461,
            627.769,
            11.96,
            Family::Extensible,
        ),
        // First content row: "x + y".
        real('x', 328.760, 6.647, 639.804, 11.96, Family::Italic),
        real('+', 338.069, 9.098, 639.804, 11.96, Family::Text),
        real('y', 349.830, 5.715, 639.804, 11.96, Family::Italic),
        // Second content row: "x + 2y^2" — same baseline as the prefix.
        real('x', 323.468, 6.647, 625.358, 11.96, Family::Italic),
        real('+', 332.776, 9.098, 625.358, 11.96, Family::Text),
        real(' ', 344.528, 0.000, 625.358, 11.96, Family::Text),
        real('2', 344.528, 5.846, 625.358, 11.96, Family::Text),
        real('y', 350.391, 5.715, 625.358, 11.96, Family::Italic),
        real('2', 356.527, 4.232, 629.696, 7.97, Family::Text),
        // Third content row: "yz".
        real('y', 336.310, 5.715, 610.912, 11.96, Family::Italic),
        real('z', 342.443, 5.499, 610.912, 11.96, Family::Italic),
        // Close bracket, both pieces.
        real(
            '\u{f8f6}',
            361.260,
            10.461,
            649.288,
            11.96,
            Family::Extensible,
        ),
        real(
            '\u{f8f8}',
            361.260,
            10.461,
            627.769,
            11.96,
            Family::Extensible,
        ),
    ];

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown
            .contains(r"\vec{v}(x, y, z) = \begin{pmatrix} x + y \\ x + 2y^2 \\ yz \end{pmatrix}"),
        "got: {markdown}"
    );
}

// A candidate content row that itself contains a big operator (not a
// bracket-piece glyph) means this bracket doesn't actually delimit a
// matrix — it's some other maths construct that happens to share the
// bracket's tolerance band. Found on Ue9.pdf Beispiel 9.3: the
// inclusion-exclusion formula's own large `\left(\right)` delimiter
// (assembled from four glyph pieces) was swallowing its nested Σ
// operators and their sub/superscript limit rows as if they were matrix
// rows. `reconstruct_matrices` must decline entirely rather than guess
// which rows to keep.
#[test]
fn a_content_row_with_a_big_operator_is_not_reconstructed_as_a_matrix() {
    let mut chars = set("\u{12}", 100.0, 120.0, extensible());
    chars.extend(set(" ", 105.0, 120.0, Style::default()));
    chars.extend(set("\u{13}", 140.0, 120.0, extensible()));
    chars.extend(set("x+y", 105.0, 110.0, maths_italic()));
    // The sum placeholder glyph (see `is_sum`) — the shape a nested Σ's
    // own limit row takes on the real document, not a real matrix row.
    chars.extend(set("X", 105.0, 100.0, extensible()));

    let markdown = chars_to_markdown(&chars);

    assert!(!markdown.contains("pmatrix"), "got: {markdown}");
}

// A page footer's own page number can land within the brace's x-alignment
// tolerance by pure coincidence, however far down the page it actually is
// — found on the real document: a footer "1" at y=26.8 (74pt below the
// second case row, `bottom_y`) passed the horizontal-proximity filter and
// joined `case_candidates`, and the resulting three-way column-alignment
// check then failed for all three, breaking the reconstruction entirely.
// `CASES_MAX_ROW_GAP` bounds how far below the brace a row may sit before
// it stops being a plausible case at all — kept as defense in depth for a
// footer shape `strip_page_furniture` doesn't recognize, even though this
// fixture's own bare "1" is now removed outright before `reconstruct_cases`
// ever runs (see `strip_page_furniture`), rather than merely being excluded
// from the case search and left dangling in the output.
#[test]
fn a_coincidentally_aligned_row_far_down_the_page_is_not_mistaken_for_a_third_case() {
    // Real per-character geometry again (see the previous test's own note
    // on why `set()`'s uniform synthetic widths aren't safe for a case
    // row's value/condition split).
    use real_char as real;

    let mut chars = vec![
        real('H', 241.289, 10.258, 331.491, 11.96, Family::Italic),
        real('(', 251.912, 4.543, 331.491, 11.96, Family::Text),
        real('t', 256.464, 4.220, 331.491, 11.96, Family::Italic),
        real('\u{2212}', 263.348, 9.289, 331.491, 11.96, Family::Symbol),
        real('b', 275.303, 4.973, 331.491, 11.96, Family::Italic),
        real(')', 280.280, 4.543, 331.491, 11.96, Family::Text),
        real('=', 288.146, 9.098, 331.491, 11.96, Family::Text),
    ];
    chars.extend([
        real('i', 85.958, 3.252, 349.921, 11.96, Family::Text),
        real('s', 89.210, 4.615, 349.921, 11.96, Family::Text),
        real('t', 93.825, 4.555, 349.921, 11.96, Family::Text),
        real('\u{1a}', 300.579, 8.966, 348.347, 11.96, Family::Extensible),
    ]);
    chars.extend([
        real('1', 314.527, 5.846, 338.813, 11.96, Family::Text),
        real('f', 330.342, 4.316, 338.813, 11.96, Family::Text),
        real('ü', 333.917, 6.504, 338.813, 11.96, Family::Text),
        real('r', 340.420, 4.555, 338.813, 11.96, Family::Text),
        real('t', 348.872, 4.220, 338.813, 11.96, Family::Italic),
        real('\u{2265}', 356.420, 9.289, 338.813, 11.96, Family::Symbol),
        real('b', 369.040, 4.973, 338.813, 11.96, Family::Italic),
    ]);
    chars.extend([
        real('0', 314.527, 5.846, 324.367, 11.96, Family::Text),
        real('f', 330.342, 4.316, 324.367, 11.96, Family::Text),
        real('ü', 333.917, 6.504, 324.367, 11.96, Family::Text),
        real('r', 340.420, 4.555, 324.367, 11.96, Family::Text),
        real('t', 348.872, 4.220, 324.367, 11.96, Family::Italic),
        real('<', 356.416, 9.098, 324.367, 11.96, Family::Italic),
        real('b', 368.837, 4.973, 324.367, 11.96, Family::Italic),
        real('.', 373.811, 3.252, 324.367, 11.96, Family::Italic),
    ]);

    // The page footer — same x-neighbourhood as the brace, but 74pt further
    // down the page than the last real case row.
    chars.push(real('1', 294.712, 5.846, 26.805, 11.96, Family::Text));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains(r"\begin{cases}"), "got: {markdown}");
    assert!(
        markdown.trim_end().ends_with(r"\end{cases}$"),
        "the footer must not survive as a stray trailing line: got {markdown:?}"
    );
}

// A subscript or inline-maths glyph sits off the baseline but belongs to the
// line it is printed on.
#[test]
fn keeps_a_slightly_raised_glyph_on_its_own_line() {
    let mut chars = set("x", 72.0, 700.0, Style::default());
    chars.extend(set(
        "2",
        77.0,
        703.0,
        Style {
            size: 7.0,
            ..Style::default()
        },
    ));
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
    chars.extend(set(
        "world",
        72.0 + 5.0 * 5.0 + 6.0,
        700.0,
        Style::default(),
    ));

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

    assert_eq!(
        lines[0].text(),
        "wird jeweils",
        "got: {:?}",
        lines[0].text()
    );
}

#[test]
fn does_not_invent_a_space_between_adjacent_glyphs() {
    let lines = group_lines(&set("adjacent", 72.0, 700.0, Style::default()));
    assert_eq!(lines[0].text(), "adjacent");
}

#[test]
fn body_size_is_the_size_most_characters_use_not_the_commonest_line() {
    let mut chars = set(
        "Big",
        72.0,
        700.0,
        Style {
            size: 20.0,
            ..Style::default()
        },
    );
    chars.extend(set(
        "Also",
        72.0,
        660.0,
        Style {
            size: 20.0,
            ..Style::default()
        },
    ));
    chars.extend(page_at(
        600.0,
        &["a much longer run of ordinary body text here"],
    ));

    let lines = group_lines(&chars);

    assert_eq!(body_font_size(&lines), BODY);
}

#[test]
fn a_larger_line_becomes_a_heading_and_body_stays_prose() {
    let mut chars = set(
        "Exercise Sheet 3",
        72.0,
        700.0,
        Style {
            size: 17.0,
            ..Style::default()
        },
    );
    chars.extend(page_at(
        680.0,
        &["some ordinary body text that sets the body size"],
    ));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.starts_with("# Exercise Sheet 3\n"),
        "got: {markdown}"
    );
    assert!(markdown.contains("some ordinary body text"));
}

#[test]
fn heading_level_follows_relative_size() {
    let body_line = "ordinary body text long enough to dominate the size vote";

    for (size, expected) in [(17.0, "#"), (14.0, "##"), (12.0, "###")] {
        let mut chars = set(
            "Title",
            72.0,
            700.0,
            Style {
                size,
                ..Style::default()
            },
        );
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
    for (index, text) in ["first para line one", "first para line two"]
        .iter()
        .enumerate()
    {
        chars.extend(set(
            text,
            72.0,
            700.0 - index as f32 * 12.0,
            Style::default(),
        ));
    }
    // Two blank lines' worth of space.
    chars.extend(set(
        "second paragraph",
        72.0,
        700.0 - 2.0 * 12.0 - 24.0,
        Style::default(),
    ));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(
        markdown,
        "first para line one first para line two\n\nsecond paragraph\n"
    );
}

#[test]
fn a_monospace_run_becomes_a_fenced_code_block_keeping_its_line_breaks() {
    let mut chars = page(&["Consider the following program."]);
    let code = Style {
        fixed: true,
        ..Style::default()
    };
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
    let mut chars = set(
        "fn main() {}",
        72.0,
        700.0,
        Style {
            fixed: true,
            ..Style::default()
        },
    );
    chars.extend(set("That was the program.", 72.0, 688.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains("```\nfn main() {}\n```"),
        "got: {markdown}"
    );
    assert!(
        markdown.ends_with("That was the program.\n"),
        "got: {markdown}"
    );
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

// Analysis_2_Blatt12.pdf's "Richtig oder Falsch" section: pdfium can only
// decode this bullet symbol as the control codepoint U+0088, which
// extract::resolve_fallback_char already (deliberately) collapses to
// U+FFFD before layout.rs ever sees it — see docs/specs/
// pdf-lettered-list-markers-design.md.
#[test]
fn an_unresolved_placeholder_glyph_becomes_a_bullet() {
    let mut chars = page(&["Prove the following statements about the set."]);
    chars.extend(set("\u{FFFD} first claim", 72.0, 660.0, Style::default()));
    chars.extend(set("\u{FFFD} second claim", 72.0, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("- first claim"), "got: {markdown}");
    assert!(markdown.contains("- second claim"), "got: {markdown}");
    assert!(
        !markdown.contains('\u{FFFD}'),
        "marker survived: {markdown}"
    );
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
    assert!(markdown.contains("2. the second part"), "got: {markdown}");
}

#[test]
fn a_lettered_sub_part_nests_under_its_digit_numbered_parent() {
    let mut chars = page(&["Answer the following."]);
    chars.extend(set("1. Solve the system:", 72.0, 660.0, Style::default()));
    chars.extend(set(
        "(a) find the fixed points",
        72.0,
        648.0,
        Style::default(),
    ));
    chars.extend(set("(b) classify each one", 72.0, 636.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("1. Solve the system:"), "got: {markdown}");
    assert!(
        markdown.contains("    1. find the fixed points"),
        "got: {markdown}"
    );
    assert!(
        markdown.contains("    2. classify each one"),
        "got: {markdown}"
    );
}

#[test]
fn each_digit_items_own_sub_list_restarts_its_own_numbering() {
    let mut chars = page(&["Two exercises, each with two sub-parts."]);
    chars.extend(set("1. First exercise", 72.0, 660.0, Style::default()));
    chars.extend(set("(a) part one", 72.0, 648.0, Style::default()));
    chars.extend(set("(b) part two", 72.0, 636.0, Style::default()));
    chars.extend(set("2. Second exercise", 72.0, 624.0, Style::default()));
    chars.extend(set("(a) part one", 72.0, 612.0, Style::default()));
    chars.extend(set("(b) part two", 72.0, 600.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(
        markdown.matches("    1. part one").count(),
        2,
        "got: {markdown}"
    );
    assert_eq!(
        markdown.matches("    2. part two").count(),
        2,
        "got: {markdown}"
    );
}

#[test]
fn a_heading_resets_running_list_numbering() {
    let mut chars = set(
        "Warm-up",
        72.0,
        700.0,
        Style {
            size: 15.0,
            ..Style::default()
        },
    );
    chars.extend(set("(a) first warm-up part", 72.0, 680.0, Style::default()));
    chars.extend(set(
        "(b) second warm-up part",
        72.0,
        668.0,
        Style::default(),
    ));
    chars.extend(set(
        "Main Task",
        72.0,
        648.0,
        Style {
            size: 15.0,
            ..Style::default()
        },
    ));
    chars.extend(set("(a) first main part", 72.0, 628.0, Style::default()));
    chars.extend(set("(b) second main part", 72.0, 616.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown.matches("1. first").count(), 2, "got: {markdown}");
    assert_eq!(markdown.matches("2. second").count(), 2, "got: {markdown}");
}

// The real shape on Analysis_2_Blatt12.pdf's exercise 6: a digit item, a
// display equation, then lettered sub-parts at the same geometric x as the
// digit item (so they get force-nested one level deeper). Confirmed via a
// live editor round-trip (mathBetweenListItems.test.ts) that an unindented
// equation here closes the list and the sub-parts land in a codeBlock
// instead of nesting — this is the fix.
#[test]
fn an_equation_between_a_digit_item_and_its_deeper_sub_parts_is_indented_to_match() {
    let mut chars = page(&["Answer the following."]);
    chars.extend(set("6. Solve the system:", 72.0, 660.0, Style::default()));
    chars.extend(set("y = 1", 200.0, 636.0, maths()));
    chars.extend(set(
        "(a) find the fixed points",
        72.0,
        612.0,
        Style::default(),
    ));
    chars.extend(set("(b) classify each one", 72.0, 600.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains("    $\n    y = 1\n    $"),
        "got: {markdown}"
    );
    assert!(
        markdown.contains("    1. find the fixed points"),
        "got: {markdown}"
    );
    assert!(
        markdown.contains("    2. classify each one"),
        "got: {markdown}"
    );
}

// The other real shape on the same sheet: an equation and follow-up prose
// between two ordinary, same-depth exercises. Must stay flat, or the second
// exercise would misnest under the first.
#[test]
fn an_equation_between_two_same_depth_digit_items_is_not_indented() {
    let mut chars = page(&["Two problems in a row."]);
    chars.extend(set("3. First problem:", 72.0, 660.0, Style::default()));
    chars.extend(set("y = 1", 200.0, 636.0, maths()));
    chars.extend(set("Some follow-up prose.", 72.0, 612.0, Style::default()));
    chars.extend(set("4. Second problem", 72.0, 588.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("$\ny = 1\n$"), "got: {markdown}");
    assert!(
        !markdown.contains("    $\n    y = 1\n    $"),
        "got: {markdown}"
    );
    assert!(
        markdown.contains("Some follow-up prose."),
        "got: {markdown}"
    );
    assert!(
        !markdown.contains("    Some follow-up prose."),
        "got: {markdown}"
    );
}

// A heading always ends a list (assign_list_numbers's own reset rule) — but
// depth itself is computed geometrically, independent of that reset, so a
// genuinely indented item after a heading can still read as deeper than
// whatever list item preceded the heading. The intervening equation must
// not be indented across that heading either.
#[test]
fn a_heading_between_a_list_item_and_a_deeper_item_prevents_indenting() {
    let mut chars = page(&["Two unrelated sections."]);
    chars.extend(set("• outer bullet", 72.0, 660.0, Style::default()));
    chars.extend(set("y = 1", 200.0, 636.0, maths()));
    chars.extend(set(
        "Unrelated Heading",
        72.0,
        612.0,
        Style {
            size: 15.0,
            ..Style::default()
        },
    ));
    chars.extend(set(
        "• inner bullet",
        72.0 + 2.0 * BODY,
        588.0,
        Style::default(),
    ));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("$\ny = 1\n$"), "got: {markdown}");
    assert!(
        !markdown.contains("    $\n    y = 1\n    $"),
        "got: {markdown}"
    );
}

// An equation between two sub-parts of the *same* depth has to be indented to
// that depth as well. At column zero it closes the sub-list it sits inside, so
// every later sub-part is promoted to a top-level item — which on
// Analysis_2_Blatt5_2026 and Blatt10 turned three sub-parts into three
// exercises of their own once the note was split into tasks.
#[test]
fn an_equation_between_two_same_depth_sub_parts_stays_inside_the_list() {
    let mut chars = page(&["Answer both parts."]);
    chars.extend(set(
        "1. Ein Bauteil hat die Form:",
        72.0,
        660.0,
        Style::default(),
    ));
    chars.extend(set(
        "(a) compute the total mass",
        72.0,
        636.0,
        Style::default(),
    ));
    chars.extend(set("M = 1", 200.0, 612.0, maths()));
    chars.extend(set(
        "(b) compute the centroid",
        72.0,
        588.0,
        Style::default(),
    ));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains("    1. compute the total mass"),
        "got: {markdown}"
    );
    assert!(
        markdown.contains("    2. compute the centroid"),
        "got: {markdown}"
    );
    assert!(
        markdown.contains("    $\n    M = 1\n    $"),
        "not indented: {markdown}"
    );
}

#[test]
fn a_bare_letter_marker_becomes_a_list_item() {
    let mut chars = page(&["Answer each of the parts below in turn."]);
    chars.extend(set("a) the first part", 72.0, 660.0, Style::default()));
    chars.extend(set("b) the second part", 72.0, 648.0, Style::default()));
    chars.extend(set("c) the third part", 72.0, 636.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("1. the first part"), "got: {markdown}");
    assert!(markdown.contains("2. the second part"), "got: {markdown}");
    assert!(markdown.contains("3. the third part"), "got: {markdown}");
    assert!(
        !markdown.contains("a) the first part"),
        "marker survived: {markdown}"
    );
}

// "Solution) ..." is a real word directly followed by a parenthesis, not
// this convention's marker — the length cap (matching the existing "(a)"
// form's own cap) keeps an 8-letter word from being mistaken for one.
#[test]
fn a_long_word_directly_followed_by_a_parenthesis_does_not_start_a_list() {
    let markdown = chars_to_markdown(&page(&["Solution) this stays prose"]));
    assert!(markdown.starts_with("Solution)"), "got: {markdown}");
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
    let body = Style {
        size: 12.0,
        ..Style::default()
    };
    let mut chars = set("abzuscha", 111.7, 495.73, body);
    // The umlaut, at exactly the x of the second "a" it sits over — an accent
    // shares its letter's position rather than following it.
    let second_a = 111.7 + 7.0 * 12.0 * ADVANCE;
    chars.extend(set("\u{00A8}", second_a, 495.26, body));
    chars.extend(set("tzen", 111.7 + 8.0 * 12.0 * ADVANCE, 495.73, body));
    chars.extend(set(
        "1",
        179.1,
        500.0,
        Style {
            size: 8.0,
            ..Style::default()
        },
    ));

    let lines = group_lines(&chars);

    assert_eq!(lines.len(), 1, "expected one line, got {lines:?}");
    assert!(
        lines[0].text().contains("abzuschätzen"),
        "got: {}",
        lines[0].text()
    );
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
    let body = Style {
        size: 12.0,
        ..Style::default()
    };
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
    let body = Style {
        size: 11.96,
        ..Style::default()
    };
    let mut chars = set("Ubungsblatt", 69.700, 739.092, body);
    chars.extend(set("\u{00A8}", 71.161, 741.643, body));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("Übungsblatt"), "got: {markdown:?}");
}

// Found against Analysis_2_Blatt12.pdf: pdfium reports the "ff" ligature of
// "Differentialgleichung" as a real, body-sized glyph with no usable Unicode
// value (extract.rs replaces it with U+FFFD rather than dropping it — see
// the comment there for why dropping is unsafe). The invariant that matters
// at this layer: whatever extract.rs hands over for an unrepresentable glyph
// must keep its geometric slot in the row, or the gap where a real character
// used to be reads as a word boundary and "Differentialgleichung" silently
// becomes the two plausible-looking words "Di erentialgleichung" — a worse
// failure than an ugly placeholder, because nothing about it looks broken.
// `pdf::ligatures::disambiguate` (called from `flush_spans`) now goes one
// step further and recovers the real letters for this specific case, since
// "Differentialgleichung" is the only dictionary word "Di\u{FFFD}erentialgleichung"
// can resolve to — but that is `ligatures`' own concern, covered by its own
// tests; what this test guards is still just the word staying one word.
#[test]
fn an_unrepresentable_glyph_stays_inside_its_word_not_a_false_space() {
    let markdown = chars_to_markdown(&page(&["Di\u{FFFD}erentialgleichung"]));
    assert!(
        markdown.contains("Differentialgleichung"),
        "an undecodable mid-word glyph must not read as a word break: got {markdown:?}"
    );
}

// Found against Analysis_2_Blatt12.pdf: the Laplace transform of the
// Heaviside step, "ist e^{-bs}/s.", typeset as a compact inline fraction
// small enough that neither the numerator nor the denominator gets its own
// separate physical row — except the numerator's base ("e") *also* carries
// its own further-reduced exponent ("-bs"), a second script level nested
// inside the first. `group_lines`'s script-attachment pass used to measure
// every script glyph's baseline tolerance only against a row's single
// tallest (body-text) anchor, so "e" — within tolerance of both its own
// exponent (touching it, distance ~0) and the true body row a few points
// below — lost the horizontal-distance tie-break to its exponent and
// stranded the whole numerator on an isolated row, away from the
// denominator that (correctly) landed in the body row below it: the
// denominator then rendered as a bare, baseless "_s" inside the prose.
// Real coordinates via dump_chars_range on Analysis_2_Blatt12.pdf.
#[test]
fn a_compact_fraction_survives_when_its_numerator_has_a_nested_exponent() {
    let body = Style {
        size: 11.96,
        ..Style::default()
    };
    let script_e = Style {
        size: 7.97,
        family: Family::Italic,
        ..Style::default()
    };
    let script_exp = Style {
        size: 5.98,
        ..Style::default()
    };

    let mut chars = set("Kontext: ist ", 85.96, 364.367, body);
    chars.push(CharBox {
        ch: 'e',
        x: 484.506,
        y: 369.074,
        width: 3.921,
        top: 373.0,
        bottom: 367.0,
        font_size: script_e.size,
        bold: false,
        italic: false,
        fixed_pitch: false,
        family: script_e.family,
    });
    chars.push(CharBox {
        ch: '\u{2212}',
        x: 488.434,
        y: 371.887,
        width: 5.756,
        top: 375.0,
        bottom: 369.0,
        font_size: script_exp.size,
        bold: false,
        italic: false,
        fixed_pitch: false,
        family: Family::Symbol,
    });
    chars.push(CharBox {
        ch: 'b',
        x: 494.190,
        y: 371.887,
        width: 3.270,
        top: 375.0,
        bottom: 369.0,
        font_size: script_exp.size,
        bold: false,
        italic: false,
        fixed_pitch: false,
        family: Family::Italic,
    });
    chars.push(CharBox {
        ch: 's',
        x: 497.460,
        y: 371.887,
        width: 3.491,
        top: 375.0,
        bottom: 369.0,
        font_size: script_exp.size,
        bold: false,
        italic: false,
        fixed_pitch: false,
        family: Family::Italic,
    });
    chars.push(CharBox {
        ch: 's',
        x: 491.023,
        y: 360.245,
        width: 3.913,
        top: 364.0,
        bottom: 358.0,
        font_size: script_e.size,
        bold: false,
        italic: false,
        fixed_pitch: false,
        family: Family::Italic,
    });
    chars.extend(set(". Dabei", 502.651, 364.367, body));

    let markdown = chars_to_markdown(&chars);
    assert!(markdown.contains(r"\frac{e^{-bs}}{s}"), "got: {markdown:?}");
}

#[test]
fn an_indented_item_nests_under_the_one_above() {
    let mut chars = page(&["Consider the following cases in order of difficulty."]);
    chars.extend(set("• outer", 72.0, 660.0, Style::default()));
    chars.extend(set("• inner", 72.0 + 2.0 * BODY, 648.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("- outer"), "got: {markdown}");
    assert!(markdown.contains("    - inner"), "got: {markdown}");
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
    chars.extend(set(
        "past the end of the line",
        72.0 + 5.0,
        648.0,
        Style::default(),
    ));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains("- a claim that runs on past the end of the line"),
        "got: {markdown}"
    );
}

#[test]
fn bold_and_italic_runs_become_markdown_emphasis() {
    let mut chars = set("plain ", 72.0, 700.0, Style::default());
    chars.extend(set(
        "bold",
        72.0 + 6.0 * 5.0,
        700.0,
        Style {
            bold: true,
            ..Style::default()
        },
    ));
    chars.extend(set(" and ", 72.0 + 10.0 * 5.0, 700.0, Style::default()));
    chars.extend(set(
        "italic",
        72.0 + 15.0 * 5.0,
        700.0,
        Style {
            italic: true,
            ..Style::default()
        },
    ));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "plain **bold** and *italic*\n");
}

// "** bold **" is not emphasis in Markdown — the padding has to sit outside.
#[test]
fn emphasis_markers_never_wrap_surrounding_whitespace() {
    let mut chars = set("see ", 72.0, 700.0, Style::default());
    chars.extend(set(
        "word ",
        72.0 + 4.0 * 5.0,
        700.0,
        Style {
            bold: true,
            ..Style::default()
        },
    ));
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

    // A lone "$" on its own line, not "$$" — the dialect the editor's own
    // `BlockMath` extension actually parses as a block (see
    // `blocks_to_markdown`'s doc comment).
    assert!(markdown.contains("$\nf(x) = 1\n$"), "got: {markdown}");
}

// Found on Analysis_2_Blatt12.pdf: "y'(t) + 2y(t) = 4cos(2t) mit y(0) = 1."
// is one centered display-equation line in the source, but the old
// all-non-maths-must-be-whitespace rule read the short connector word
// "mit" as disqualifying prose, dropping the whole line into a paragraph
// as two small inline `$…$` spans instead of one display block.
// `is_mostly_maths` allows it through by character-count ratio instead,
// and the connector survives inside the equation as `\text{}`.
#[test]
fn a_display_equation_keeps_a_short_connector_word_inside_it() {
    let mut chars = page(&["Consider the following identity."]);
    chars.extend(set("f(x) = 1", 150.0, 660.0, maths_italic()));
    let after_eq = 150.0 + "f(x) = 1".chars().count() as f32 * BODY * ADVANCE;
    chars.extend(set(" mit ", after_eq, 660.0, Style::default()));
    let after_mit = after_eq + " mit ".chars().count() as f32 * BODY * ADVANCE;
    chars.extend(set("g(x) = 2", after_mit, 660.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains("$\nf(x) = 1 \\text{ mit } g(x) = 2\n$"),
        "got: {markdown}"
    );
}

// The other side of the same change: an ordinary sentence that merely
// references one inline formula must not tip into becoming a display
// block just because it now tolerates *some* non-maths text — text still
// has to be the small minority, not the majority, of the line.
#[test]
fn a_sentence_that_merely_contains_a_formula_stays_inline_not_display() {
    let mut chars = set("Die Zahl ", 72.0, 700.0, Style::default());
    let after = 72.0 + "Die Zahl ".chars().count() as f32 * BODY * ADVANCE;
    chars.extend(set("x", after, 700.0, maths_italic()));
    let after_x = after + BODY * ADVANCE;
    chars.extend(set(
        " ist eine gerade Zahl.",
        after_x,
        700.0,
        Style::default(),
    ));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains("Die Zahl $x$ ist eine gerade Zahl."),
        "got: {markdown}"
    );
    assert!(
        !markdown.lines().any(|l| l.trim() == "$"),
        "should not become a display block: {markdown}"
    );
}

#[test]
fn maths_inside_a_sentence_stays_inline() {
    let mut chars = set("Sei ", 72.0, 700.0, Style::default());
    chars.extend(set("f", 72.0 + 4.0 * 5.0, 700.0, maths_italic()));
    chars.extend(set(
        " gegeben und stetig",
        72.0 + 5.0 * 5.0,
        700.0,
        Style::default(),
    ));

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
    assert_eq!(
        regions.len(),
        1,
        "expected one region, got {:?}",
        lines[0].content
    );
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
    assert_eq!(
        regions.len(),
        2,
        "wide gap merged into one region: {:?}",
        lines[0].content
    );
}

#[test]
fn prose_far_from_an_equation_is_not_swallowed_into_it() {
    let mut chars = set("x", 72.0, 700.0, maths());
    // Well beyond the bridging distance.
    chars.extend(set("und", 72.0 + 40.0, 700.0, Style::default()));
    chars.extend(set("y", 72.0 + 100.0, 700.0, maths()));

    let lines = group_lines(&chars);

    let regions = lines[0]
        .content
        .iter()
        .filter(|i| matches!(i, Inline::Maths(_)))
        .count();
    assert_eq!(regions, 2, "got: {:?}", lines[0].content);
    assert!(
        lines[0].text().contains("und"),
        "prose lost: {}",
        lines[0].text()
    );
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
    assert_eq!(
        regions.len(),
        1,
        "expected one region, got {:?}",
        lines[0].content
    );
    if let Inline::Maths(latex) = regions[0] {
        assert!(latex.contains("\\log"), "got: {latex}");
    }
}

// Found on Analysis_2_Blatt5_2026.pdf: "Potenzialfunktion Φ(x, y)" left Φ
// stranded as plain prose — TeX sets an upright Greek capital like Φ in the
// same upright text font prose uses, and with *no* space glyph between the
// German word and the symbol (unlike the "log"/"n" case above, which at
// least has real word gaps elsewhere), the fixed known-operator-name list's
// backward word scan can't isolate Φ as its own run at all: `is_alphabetic`
// makes no distinction between the two, so a lone-symbol check has to peel
// it off one character at a time instead of matching a whole word.
#[test]
fn a_lone_greek_symbol_touching_its_word_is_still_absorbed() {
    let mut chars = set("Potenzialfunktion", 150.0, 700.0, Style::default());
    // Directly against "Potenzialfunktion" — zero gap, the case that broke.
    chars.extend(set("\u{3a6}", 215.0, 700.0, Style::default()));
    chars.extend(set("(x, y)", 220.0, 700.0, maths_italic()));

    let lines = group_lines(&chars);

    let regions: Vec<_> = lines[0]
        .content
        .iter()
        .filter(|i| matches!(i, Inline::Maths(_)))
        .collect();
    assert_eq!(
        regions.len(),
        1,
        "expected one region, got {:?}",
        lines[0].content
    );
    if let Inline::Maths(latex) = regions[0] {
        assert!(latex.contains("\\Phi"), "got: {latex}");
    }
    assert!(
        lines[0].text().contains("Potenzialfunktion"),
        "prose lost: {}",
        lines[0].text()
    );
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
    assert_eq!(
        regions.len(),
        2,
        "\"to\" was absorbed into the equation: {:?}",
        lines[0].content
    );
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
        Style {
            size: BODY * 0.7,
            ..Style::default()
        },
    ));

    let markdown = chars_to_markdown(&chars);

    assert!(
        !markdown.contains("^3"),
        "footnote leaked into the equation: {markdown}"
    );
    // The footnote digit itself must survive as ordinary trailing text, not
    // vanish — it is the mark a reader follows to the footnote.
    assert!(
        markdown.trim_end().ends_with('3'),
        "footnote digit lost: {markdown}"
    );
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
    assert!(
        !markdown.contains(")$"),
        "closing paren leaked into the region: {markdown}"
    );
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

    assert!(
        markdown.contains("z^2"),
        "exponent lost its base: {markdown}"
    );
    assert!(
        !markdown.contains("∮^2") && !markdown.contains("oint}^2"),
        "got: {markdown}"
    );
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
    assert_eq!(
        lines.len(),
        2,
        "the subscript split off into its own line: {lines:?}"
    );
    assert!(
        lines[1]
            .content
            .iter()
            .any(|i| matches!(i, Inline::Maths(s) if s.contains("mathcal{C}"))),
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

// A big operator's limit (`\iiint_K`) is geometrically the same shape as a
// bar-less fraction: an operator row stacked above a limit row, both
// straddled by a baseline. Found on a real sheet reconstructing as
// `\frac{\int\int\int}{K}` instead — `find_stacked_pair` must not let a
// big-operator-only row act as a fraction's numerator.
#[test]
fn a_big_operator_stacked_over_its_limit_becomes_a_subscript_not_a_fraction() {
    let mut chars = set("\u{222b}\u{222b}\u{222b}", 300.0, 700.0, extensible());
    // "M =" and "a + b" sit far enough apart to read as two separate maths
    // regions on the same baseline — the shape a real equation's own prefix
    // and integrand take (`M =` ... `(y + 1)dxdydz.`), which is what lets
    // the operator's subscript splice in between them rather than only at
    // the row's end.
    chars.extend(set("M =", 250.0, 690.0, maths_italic()));
    chars.extend(set("a + b", 300.0, 690.0, maths_italic()));
    chars.extend(set("K", 305.0, 680.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains(r"M = \iiint_{K} a + b"),
        "got: {markdown}"
    );
    assert!(
        !markdown.contains("\\frac"),
        "misread as a fraction: {markdown}"
    );
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

    assert!(
        markdown.contains(r"\frac{a + b}{c + d} dz"),
        "got: {markdown}"
    );
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
    let mut chars = page_at(
        900.0,
        &["ordinary paragraph text", "with a normal line spacing"],
    );
    chars.extend(set("a + b", 300.0, 700.0, maths_italic()));
    // Closer to the numerator than the real denominator is, and — because of
    // the wide gap between "f(z) =" and "." — reads as is_display_maths, the
    // same as a genuine numerator or denominator would.
    chars.extend(set("f(z) =", 250.0, 693.0, maths_italic()));
    chars.extend(set(".", 340.0, 693.0, maths_italic()));
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains(r"\frac{a + b}{c + d}"), "got: {markdown}");
    assert!(
        !markdown.contains(r"\frac{a + b}{f(z) ="),
        "paired with the baseline instead: {markdown}"
    );
}

// `splice_into_baseline` appends the fraction after a baseline that has
// nothing trailing it ("R =" with no suffix) — leaving the baseline's own
// `Inline::Maths("R =")` sitting directly next to the spliced-in
// `Inline::Maths(frac)`. `render_content` used to wrap each independently,
// producing "$R =$$\frac{a + b}{c + d}$" — two adjacent spans glued with no
// separator, seen for real on Analysis_2_Blatt10.pdf/Analysis_2_Blatt11.pdf.
#[test]
fn a_baseline_prefix_with_nothing_after_the_fraction_does_not_glue_two_maths_spans() {
    let mut chars = page_at(
        900.0,
        &["ordinary paragraph text", "with a normal line spacing"],
    );
    chars.extend(set("a + b", 300.0, 700.0, maths_italic()));
    chars.extend(set("R =", 250.0, 693.0, maths_italic()));
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains(r"R = \frac{a + b}{c + d}"),
        "got: {markdown}"
    );
    assert!(
        !markdown.contains("$$"),
        "adjacent maths spans left glued: {markdown}"
    );
}

// A \binom vector's large open/close parens land on their own line — their
// y matches neither content row above/below them (see
// docs/specs/pdf-table-fraction-maths-guards-design.md for why: TeX draws
// a tall delimiter at one shared reference point, not once per row it
// spans). Once latex::to_latex turns them into plain "(" / ")" (the
// operator-glyphs fix), their presence is evidence this is a
// delimiter-flanked construct, not a bare fraction — the pairing must be
// refused, unlike the unflanked case in
// a_numerator_and_denominator_on_separate_lines_become_one_fraction above.
#[test]
fn a_binom_flanked_pair_of_lines_is_not_mistaken_for_a_bare_fraction() {
    // Ordinary paragraph text elsewhere, for the same reason
    // a_baseline_shaped_line_is_never_mistaken_for_the_other_half_of_a_fraction
    // needs it: find_stacked_pair scopes pairing to one paragraph using a
    // *median* line gap, and the delimiter row is itself an extra line that
    // feeds that median. Placing it 20pt above the numerator (matching the
    // numerator-denominator gap itself, rather than an arbitrary smaller
    // value) keeps the median from dropping low enough to make the real
    // numerator-denominator gap look like a paragraph break by comparison —
    // confirmed necessary by first observing this fixture fail for that
    // unrelated reason with a closer delimiter placement.
    let mut chars = page_at(
        900.0,
        &["ordinary paragraph text", "with a normal line spacing"],
    );
    chars.extend(set("(", 290.0, 720.0, extensible()));
    chars.extend(set(")", 340.0, 720.0, extensible()));
    chars.extend(set("a + b", 300.0, 700.0, maths_italic()));
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(
        !markdown.contains(r"\frac{a + b}{c + d}"),
        "got: {markdown}"
    );
    assert!(
        markdown.contains("a + b"),
        "numerator content lost: {markdown}"
    );
    assert!(
        markdown.contains("c + d"),
        "denominator content lost: {markdown}"
    );
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
        blocks
            .iter()
            .all(|b| !matches!(b, Block::Paragraph { content } if content.is_empty())),
        "got: {blocks:?}"
    );
}

// The shape a real exercise sheet arrives in, end to end.
#[test]
fn converts_a_representative_exercise_sheet() {
    let mut chars = set(
        "Aufgabe 1",
        72.0,
        700.0,
        Style {
            size: 15.0,
            ..Style::default()
        },
    );
    chars.extend(set(
        "Sei G eine endliche Gruppe. Zeigen Sie, dass",
        72.0,
        680.0,
        Style::default(),
    ));
    chars.extend(set(
        "die folgenden Aussagen gelten.",
        72.0,
        668.0,
        Style::default(),
    ));
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
        content: vec![Inline::TableRow(cells, true)],
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
        vec![Inline::Text(Span {
            text: "a".into(),
            bold: false,
            italic: false,
        })],
        vec![Inline::Text(Span {
            text: "b".into(),
            bold: false,
            italic: false,
        })],
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

#[test]
fn table_gutters_finds_the_shared_gap_between_two_rows() {
    let mut row1 = set("ID", 72.0, 700.0, Style::default());
    row1.extend(set("Name", 100.0, 700.0, Style::default()));
    let mut row2 = set("1", 72.0, 688.0, Style::default());
    row2.extend(set("Alice", 100.0, 688.0, Style::default()));

    let gutters = table_gutters(&[row1, row2]).expect("expected a shared gutter");

    assert_eq!(gutters.len(), 1);
    assert!(gutters[0] > 82.0 && gutters[0] < 100.0);
}

// Different word lengths across the two lines mean the union of their
// non-whitespace spans has no gap left over anywhere — the same property
// that keeps ordinary prose from ever being mistaken for a table.
#[test]
fn table_gutters_is_none_when_rows_share_no_gap() {
    let row1 = set("hello world today", 72.0, 700.0, Style::default());
    let row2 = set("goodbye friend now", 72.0, 688.0, Style::default());
    assert_eq!(table_gutters(&[row1, row2]), None);
}

#[test]
fn split_row_into_cells_buckets_by_the_cut_points() {
    let row: Vec<(usize, CharBox)> = set("AB", 72.0, 700.0, Style::default())
        .into_iter()
        .chain(set("CD", 100.0, 700.0, Style::default()))
        .enumerate()
        .collect();

    let cells = split_row_into_cells(&row, &[90.0]);

    assert_eq!(cells.len(), 2);
    assert_eq!(cells[0].iter().map(|(_, c)| c.ch).collect::<String>(), "AB");
    assert_eq!(cells[1].iter().map(|(_, c)| c.ch).collect::<String>(), "CD");
}

#[test]
fn cell_has_content_is_false_for_whitespace_or_nothing() {
    let whitespace_only: Vec<(usize, CharBox)> = set("  ", 72.0, 700.0, Style::default())
        .into_iter()
        .enumerate()
        .collect();
    assert!(!cell_has_content(&whitespace_only));
    assert!(!cell_has_content(&[]));

    let real: Vec<(usize, CharBox)> = set("x", 72.0, 700.0, Style::default())
        .into_iter()
        .enumerate()
        .collect();
    assert!(cell_has_content(&real));
}

#[test]
fn row_crosses_gutters_detects_a_straddling_character() {
    let row = set("straddle", 85.0, 700.0, Style::default());
    assert!(row_crosses_gutters(&row, &[87.0]));
}

#[test]
fn row_crosses_gutters_is_false_when_nothing_straddles() {
    let row = set("AB", 72.0, 700.0, Style::default());
    assert!(!row_crosses_gutters(&row, &[90.0]));
}

fn table_row_cell_text(cell: &[Inline]) -> String {
    cell.iter()
        .filter_map(|i| match i {
            Inline::Text(span) => Some(span.text.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_simple_two_column_table_becomes_table_row_lines() {
    let mut chars = set("ID", 72.0, 700.0, Style::default());
    chars.extend(set("Name", 100.0, 700.0, Style::default()));
    chars.extend(set("1", 72.0, 688.0, Style::default()));
    chars.extend(set("Alice", 100.0, 688.0, Style::default()));
    chars.extend(set("2", 72.0, 676.0, Style::default()));
    chars.extend(set("Bob", 100.0, 676.0, Style::default()));

    let lines = group_lines(&chars);

    assert_eq!(lines.len(), 3);
    for line in &lines {
        assert!(
            matches!(line.content.as_slice(), [Inline::TableRow(_, _)]),
            "expected every line to be a table row, got {:?}",
            line.content
        );
    }
    let Inline::TableRow(header_cells, _) = &lines[0].content[0] else {
        panic!("expected TableRow");
    };
    assert_eq!(header_cells.len(), 2);
    assert_eq!(table_row_cell_text(&header_cells[0]), "ID");
    assert_eq!(table_row_cell_text(&header_cells[1]), "Name");
}

// Mirrors table_test.pdf's wrapped-cell table: a row with all three cells
// filled, followed by a row with content in only the middle (Description)
// cell — the signature of a wrapped line, not a new row. This is the exact
// shape that produces the "files.Team A" bug in today's pipeline.
#[test]
fn a_wrapped_cell_merges_into_the_row_above_it_instead_of_a_new_row() {
    let mut chars = set("Component", 72.0, 700.0, Style::default());
    chars.extend(set("Description", 150.0, 700.0, Style::default()));
    chars.extend(set("Owner", 430.0, 700.0, Style::default()));

    chars.extend(set("Core", 72.0, 688.0, Style::default()));
    chars.extend(set(
        "Handles extraction of text",
        150.0,
        688.0,
        Style::default(),
    ));
    chars.extend(set("A", 430.0, 688.0, Style::default()));

    // Continuation row: only the Description column has content.
    chars.extend(set("and more here", 150.0, 676.0, Style::default()));

    let lines = group_lines(&chars);

    // Exactly 2 table-row lines — the continuation must not have become a
    // third.
    assert_eq!(lines.len(), 2);
    let Inline::TableRow(data_cells, _) = &lines[1].content[0] else {
        panic!("expected TableRow");
    };
    assert_eq!(
        table_row_cell_text(&data_cells[1]),
        "Handles extraction of text and more here"
    );
}

#[test]
fn a_lone_row_never_becomes_a_table_row_line() {
    let chars = set("just one row of text here", 72.0, 700.0, Style::default());
    let lines = group_lines(&chars);
    assert!(lines
        .iter()
        .all(|l| !matches!(l.content.as_slice(), [Inline::TableRow(_, _)])));
}

#[test]
fn two_rows_with_no_shared_gutter_produce_no_table_row_lines() {
    let mut chars = set("hello world today", 72.0, 700.0, Style::default());
    chars.extend(set("goodbye friend now", 72.0, 688.0, Style::default()));
    let lines = group_lines(&chars);
    assert!(lines
        .iter()
        .all(|l| !matches!(l.content.as_slice(), [Inline::TableRow(_, _)])));
}

// A 2x2 grid of maths-italic content — the shape a small \binom/\cases
// block's aligned "columns" take — must not be mistaken for a real data
// table just because it happens to satisfy the gutter/fill-ratio checks
// above. Every character here is maths-family, so maths_coverage_ratio
// should read close to 1.0 and reject the candidate.
#[test]
fn a_maths_heavy_two_by_two_grid_is_not_mistaken_for_a_table() {
    let mut chars = set("H", 200.0, 700.0, maths_italic());
    chars.extend(set("K", 260.0, 700.0, maths_italic()));
    chars.extend(set("L", 200.0, 688.0, maths_italic()));
    chars.extend(set("M", 260.0, 688.0, maths_italic()));

    let lines = group_lines(&chars);

    assert!(
        lines
            .iter()
            .all(|l| !matches!(l.content.as_slice(), [Inline::TableRow(_, _)])),
        "expected no TableRow lines, got {lines:?}"
    );
}

// Issue #93: two stacked display equations, each followed by a prose remark
// (Ue1.pdf Beispiel 1.5), line up into two gutter-separated columns but are
// an equation column with a caption, not a table. A column of long pure-maths
// cells is the tell.
#[test]
fn stacked_equations_with_prose_remarks_are_not_a_table() {
    let mut chars = set("ABCDEFGHIJ", 100.0, 700.0, maths_italic());
    chars.extend(set(
        "die ersten Zahlen eins",
        300.0,
        700.0,
        Style::default(),
    ));
    chars.extend(set("KLMNOPQRSTUV", 100.0, 684.0, maths_italic()));
    chars.extend(set(
        "die ersten Zahlen zwei",
        300.0,
        684.0,
        Style::default(),
    ));

    let lines = group_lines(&chars);

    assert!(
        lines
            .iter()
            .all(|l| !matches!(l.content.as_slice(), [Inline::TableRow(_, _)])),
        "expected no TableRow lines, got {lines:?}"
    );
}

// Issue #92: a 2x3 grid of unlabeled side-by-side formulas (Ue1.pdf
// Beispiel 1.1's X_1/Y_1/Z_1 over X_2/Y_2/Z_2) used to flatten into one
// run-on `Block::MathsDisplay` because `group_blocks` joins consecutive
// display-maths lines unconditionally. Each row here is a complete set of
// equations on its own — two-plus `Maths` pieces, each with its own `=` —
// so the two rows must land in separate blocks instead of merging.
#[test]
fn a_grid_of_independent_equation_rows_splits_into_separate_maths_blocks() {
    let mut chars = set("X=AB", 100.0, 700.0, maths_italic());
    chars.extend(set("Y=CD", 200.0, 700.0, maths_italic()));
    chars.extend(set("Z=EF", 300.0, 700.0, maths_italic()));
    chars.extend(set("P=GH", 100.0, 684.0, maths_italic()));
    chars.extend(set("Q=IJ", 200.0, 684.0, maths_italic()));
    chars.extend(set("R=KL", 300.0, 684.0, maths_italic()));

    let blocks = group_blocks(&group_lines(&chars));

    let maths_blocks: Vec<&Block> = blocks
        .iter()
        .filter(|b| matches!(b, Block::MathsDisplay { .. }))
        .collect();
    assert_eq!(
        maths_blocks.len(),
        2,
        "expected the two equation rows to land in separate blocks, got {blocks:?}"
    );
}

// A row with no relation of its own (Ue1.pdf Beispiel 1.5's "+ n + (n-1) +
// ... + 1", the second half of a bar-less sum split across two baselines)
// is a fragment that needs the row above it to complete it, not an
// independent equation — it must still merge into the preceding row's
// block exactly as before, regardless of how many `Maths` pieces that
// preceding row has.
#[test]
fn a_continuation_row_without_its_own_relation_still_merges() {
    let mut chars = set("A=", 100.0, 700.0, maths_italic());
    chars.extend(set("B", 300.0, 700.0, maths_italic()));
    chars.extend(set("C", 100.0, 684.0, maths_italic()));

    let blocks = group_blocks(&group_lines(&chars));

    let maths_blocks: Vec<&Block> = blocks
        .iter()
        .filter(|b| matches!(b, Block::MathsDisplay { .. }))
        .collect();
    assert_eq!(
        maths_blocks.len(),
        1,
        "expected the continuation row to stay merged, got {blocks:?}"
    );
}

#[test]
fn consecutive_table_row_lines_merge_into_one_table_block() {
    let mut chars = set("ID", 72.0, 700.0, Style::default());
    chars.extend(set("Name", 100.0, 700.0, Style::default()));
    chars.extend(set("1", 72.0, 688.0, Style::default()));
    chars.extend(set("Alice", 100.0, 688.0, Style::default()));

    let blocks = group_blocks(&group_lines(&chars));

    assert_eq!(blocks.len(), 1);
    let Block::Table { rows } = &blocks[0] else {
        panic!("expected a single Block::Table, got {:?}", blocks[0]);
    };
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].len(), 2);
}

#[test]
fn a_simple_table_renders_as_gfm() {
    let mut chars = set("ID", 72.0, 700.0, Style::default());
    chars.extend(set("Name", 100.0, 700.0, Style::default()));
    chars.extend(set("1", 72.0, 688.0, Style::default()));
    chars.extend(set("Alice", 100.0, 688.0, Style::default()));
    chars.extend(set("2", 72.0, 676.0, Style::default()));
    chars.extend(set("Bob", 100.0, 676.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(
        markdown.trim_end(),
        "| ID | Name |\n| --- | --- |\n| 1 | Alice |\n| 2 | Bob |"
    );
}

#[test]
fn a_wrapped_cell_produces_one_clean_data_row() {
    let mut chars = set("Component", 72.0, 700.0, Style::default());
    chars.extend(set("Description", 150.0, 700.0, Style::default()));
    chars.extend(set("Owner", 430.0, 700.0, Style::default()));
    chars.extend(set("Core", 72.0, 688.0, Style::default()));
    chars.extend(set(
        "Handles extraction of text",
        150.0,
        688.0,
        Style::default(),
    ));
    chars.extend(set("A", 430.0, 688.0, Style::default()));
    chars.extend(set("and more here", 150.0, 676.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(
        markdown.trim_end(),
        "| Component | Description | Owner |\n\
         | --- | --- | --- |\n\
         | Core | Handles extraction of text and more here | A |"
    );
}

#[test]
fn a_literal_pipe_in_a_cell_is_escaped() {
    assert_eq!(escape_table_cell("a | b"), "a \\| b");
    assert_eq!(escape_table_cell("no pipes here"), "no pipes here");
}

// Regression test for a real bug found against table_test.pdf: a wrapped
// cell's continuation line folds into its anchor row rather than becoming
// its own Line, so the y-gap from that anchor to the *next* row is bigger
// than an ordinary row-to-row gap — group_blocks's own vertical-gap
// heuristic used to misread that as "the table ended here" and split one
// table into several. Two separate tables (a real gap between them) must
// still split correctly, while a table whose own rows wrap must not.
#[test]
fn two_separate_tables_with_wrapped_rows_stay_separate_and_intact() {
    let mut chars = set("ID", 72.0, 700.0, Style::default());
    chars.extend(set("Note", 150.0, 700.0, Style::default()));
    chars.extend(set("1", 72.0, 688.0, Style::default()));
    chars.extend(set(
        "first row of the note text",
        150.0,
        688.0,
        Style::default(),
    ));
    chars.extend(set("continues down here", 150.0, 676.0, Style::default()));
    chars.extend(set("2", 72.0, 664.0, Style::default()));
    chars.extend(set(
        "second entry text goes here",
        150.0,
        664.0,
        Style::default(),
    ));

    // A real gap — a new, unrelated table starts well below.
    chars.extend(set("Component", 72.0, 600.0, Style::default()));
    chars.extend(set("Description", 150.0, 600.0, Style::default()));
    chars.extend(set("Core", 72.0, 588.0, Style::default()));
    chars.extend(set(
        "first wrapped line of text",
        150.0,
        588.0,
        Style::default(),
    ));
    chars.extend(set(
        "second wrapped line here",
        150.0,
        576.0,
        Style::default(),
    ));
    chars.extend(set("Engine", 72.0, 564.0, Style::default()));
    chars.extend(set(
        "another data row entry",
        150.0,
        564.0,
        Style::default(),
    ));

    let blocks = group_blocks(&group_lines(&chars));

    let tables: Vec<&Vec<Vec<Vec<Inline>>>> = blocks
        .iter()
        .filter_map(|b| match b {
            Block::Table { rows } => Some(rows),
            _ => None,
        })
        .collect();
    assert_eq!(
        tables.len(),
        2,
        "expected exactly two separate tables, got {blocks:?}"
    );
    assert_eq!(
        tables[0].len(),
        3,
        "first table should keep all 3 logical rows"
    );
    assert_eq!(
        tables[1].len(),
        3,
        "second table should keep all 3 logical rows"
    );
}

fn image_ref_line(placeholder: &str, alt: &str, y: f32, left: f32, right: f32) -> Line {
    Line {
        content: vec![Inline::ImageRef(placeholder.to_string(), alt.to_string())],
        x: left,
        right,
        y,
        font_size: 0.0,
        fixed_pitch: false,
        is_display_maths: false,
        ends_hyphenated: false,
    }
}

#[test]
fn an_image_ref_line_is_not_blank() {
    assert!(!image_ref_line("pdf-image://0", "", 700.0, 72.0, 200.0).is_blank());
}

#[test]
fn an_image_ref_lines_own_text_is_empty() {
    assert_eq!(
        image_ref_line("pdf-image://0", "a figure", 700.0, 72.0, 200.0).text(),
        ""
    );
}

#[test]
fn a_block_image_renders_as_a_markdown_image_reference() {
    let markdown = blocks_to_markdown(&[Block::Image {
        placeholder: "pdf-image://0".to_string(),
        alt: String::new(),
    }]);
    assert_eq!(markdown.trim_end(), "![](pdf-image://0)");
}

#[test]
fn an_image_lands_between_the_two_paragraphs_it_sits_between() {
    let mut chars = set("first paragraph text here", 72.0, 700.0, Style::default());
    chars.extend(set(
        "second paragraph text here",
        72.0,
        640.0,
        Style::default(),
    ));

    let images = vec![ImageRef {
        placeholder: "pdf-image://0".to_string(),
        alt: String::new(),
        left: 72.0,
        right: 300.0,
        y: 670.0, // between the two paragraphs' y positions
    }];

    let markdown = chars_and_images_to_markdown(&chars, &images);
    let parts: Vec<&str> = markdown.trim_end().split("\n\n").collect();

    assert_eq!(parts.len(), 3, "got: {markdown}");
    assert_eq!(parts[0], "first paragraph text here");
    assert_eq!(parts[1], "![](pdf-image://0)");
    assert_eq!(parts[2], "second paragraph text here");
}

#[test]
fn two_images_never_merge_into_one_block() {
    let images = vec![
        ImageRef {
            placeholder: "pdf-image://0".to_string(),
            alt: String::new(),
            left: 72.0,
            right: 300.0,
            y: 700.0,
        },
        ImageRef {
            placeholder: "pdf-image://1".to_string(),
            alt: String::new(),
            left: 72.0,
            right: 300.0,
            y: 680.0,
        },
    ];

    let markdown = chars_and_images_to_markdown(&[], &images);

    assert_eq!(
        markdown.trim_end(),
        "![](pdf-image://0)\n\n![](pdf-image://1)"
    );
}

#[test]
fn no_images_behaves_exactly_like_chars_to_markdown() {
    let chars = set("ordinary text", 72.0, 700.0, Style::default());
    assert_eq!(
        chars_and_images_to_markdown(&chars, &[]),
        chars_to_markdown(&chars)
    );
}

#[test]
fn strips_an_isolated_bare_number_footer() {
    let mut chars = page(&["Body text on the page."]);
    // 40pt below the body line (10pt font * 3.0 gap ratio = 30pt threshold).
    chars.extend(set("3", 72.0, 700.0 - 12.0 - 40.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "Body text on the page.\n");
}

#[test]
fn strips_an_isolated_labelled_footer() {
    let mut chars = page(&["Body text on the page."]);
    chars.extend(set(
        "Page 3 of 10",
        72.0,
        700.0 - 12.0 - 40.0,
        Style::default(),
    ));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "Body text on the page.\n");
}

#[test]
fn a_number_at_normal_line_spacing_is_kept() {
    // "3" sits right below its paragraph at ordinary line spacing (12pt),
    // well under the isolation threshold — it reads as real content (e.g.
    // the last line of a short answer), not a footer.
    let chars = page(&["The answer is:", "3"]);

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains('3'), "markdown was: {markdown:?}");
}

#[test]
fn a_numbered_list_item_is_never_mistaken_for_a_page_number() {
    let mut chars = page(&["Body paragraph here."]);
    chars.extend(set(
        "1. Aufgabe",
        72.0,
        700.0 - 12.0 - 40.0,
        Style::default(),
    ));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("Aufgabe"), "markdown was: {markdown:?}");
}

#[test]
fn a_single_row_page_is_left_untouched() {
    let chars = set("3", 72.0, 700.0, Style::default());

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "3\n");
}

// Rules reach the row stage without changing anything on their own: the
// rule-free default has to stay byte-identical to today's output, because
// that is what makes "the existing geometric passes handle the leftovers" a
// structural property rather than a promise.
#[test]
fn a_page_with_no_rules_converts_exactly_as_before() {
    let chars = page_at(700.0, &["Hello world", "a second line of prose"]);

    assert_eq!(
        chars_and_rules_to_markdown(&chars, &[]),
        chars_to_markdown(&chars)
    );
}

#[test]
fn group_lines_with_no_rules_matches_group_lines() {
    let chars = page_at(700.0, &["Hello world", "a second line of prose"]);

    assert_eq!(group_lines_with_rules(&chars, &[]), group_lines(&chars));
}

use super::rules::RuleBox;

fn rule_at(x0: f32, x1: f32, y: f32) -> RuleBox {
    RuleBox {
        x0,
        x1,
        y,
        thickness: 0.96,
    }
}

// The bar states outright what the geometric pass has to infer: the row above
// it is a numerator and the row below it is a denominator.
#[test]
fn a_drawn_bar_pairs_the_rows_it_separates() {
    let mut chars = set("a + b", 300.0, 700.0, maths_italic());
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));
    let rules = [rule_at(298.0, 330.0, 690.0)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(markdown.contains(r"\frac{a + b}{c + d}"), "got: {markdown}");
}

// The crux. On a real contour integral the baseline row sits *closer* to the
// bar than the denominator does, so ranking candidate rows by vertical
// distance picks the wrong one. Only "most of this row's characters sit under
// a bar" separates them.
#[test]
fn the_baseline_row_is_not_mistaken_for_the_denominator() {
    let mut chars = set("a", 245.0, 248.0, maths_italic());
    // Outside the bar's span, and nearer to the bar than the denominator is.
    chars.extend(set("dz", 275.0, 240.0, maths_italic()));
    // Under the bar, and further from it.
    chars.extend(set("x", 245.0, 234.0, maths_italic()));
    let rules = [rule_at(240.0, 270.0, 242.0)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(markdown.contains(r"\frac{a}{x}"), "got: {markdown}");
}

// A bar with nothing under it is page furniture — a header rule — and must
// not drag unrelated content into a fraction.
#[test]
fn a_bar_with_no_content_in_its_span_reconstructs_nothing() {
    let chars = page_at(700.0, &["Hello world", "a second line of prose"]);
    // Spans the full page width at the very top, like a header rule.
    let rules = [rule_at(-0.4, 595.67, 737.4)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(!markdown.contains(r"\frac"), "got: {markdown}");
}

// Half-reconstructed mathematics is worse than none: a numerator character
// stranded far outside every span means the bars do not describe this row, so
// the whole band gives up and leaves the rows to the existing passes.
#[test]
fn a_character_far_outside_every_span_abandons_the_band() {
    let mut chars = set("a", 245.0, 248.0, maths_italic());
    chars.extend(set("Q", 480.0, 248.0, maths_italic()));
    chars.extend(set("x", 245.0, 234.0, maths_italic()));
    let rules = [rule_at(240.0, 270.0, 242.0)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(!markdown.contains(r"\frac{a}{x}"), "got: {markdown}");
}

// Three fractions side by side under one row of bars — the shape
// Analysis_2_Blatt11.pdf item 4 sets. Every numerator shares one row and
// every denominator another, so no amount of pairing whole *lines* can
// recover three separate fractions; only the bars' own x-spans say where one
// term ends and the next begins. The baseline's own content is Task 5's
// concern, so this asserts only the fractions.
#[test]
fn three_bars_on_one_row_become_three_separate_fractions() {
    let mut chars = set("a", 245.0, 248.0, maths_italic());
    chars.extend(set("b", 295.0, 248.0, maths_italic()));
    chars.extend(set("c", 355.0, 248.0, maths_italic()));

    chars.extend(set("x", 245.0, 234.0, maths_italic()));
    chars.extend(set("y", 295.0, 234.0, maths_italic()));
    chars.extend(set("z", 355.0, 234.0, maths_italic()));

    let rules = [
        rule_at(240.0, 270.0, 242.0),
        rule_at(290.0, 330.0, 242.0),
        rule_at(350.0, 370.0, 242.0),
    ];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(markdown.contains(r"\frac{a}{x}"), "got: {markdown}");
    assert!(markdown.contains(r"\frac{b}{y}"), "got: {markdown}");
    assert!(markdown.contains(r"\frac{c}{z}"), "got: {markdown}");
}

// Analysis_2_Blatt11.pdf item 4: a contour integral whose integrand is a sum
// of three fractions. Every numerator shares one row, every denominator
// another, and the baseline carries both the `+` connectors and the
// integral's own `dz,`. That trailing `dz,` is why `connector_baseline`
// rejects the row and the geometric pass never fires — it demands a baseline
// of nothing but connectors.
#[test]
fn three_bars_on_one_row_become_three_fractions_around_their_connectors() {
    let mut chars = set("a", 245.0, 248.0, maths_italic());
    chars.extend(set("b", 295.0, 248.0, maths_italic()));
    chars.extend(set("c", 355.0, 248.0, maths_italic()));

    chars.extend(set("+", 275.0, 240.0, maths()));
    chars.extend(set("+", 335.0, 240.0, maths()));
    chars.extend(set("dz", 375.0, 240.0, maths_italic()));

    chars.extend(set("x", 245.0, 234.0, maths_italic()));
    chars.extend(set("y", 295.0, 234.0, maths_italic()));
    chars.extend(set("z", 355.0, 234.0, maths_italic()));

    let rules = [
        rule_at(240.0, 270.0, 242.0),
        rule_at(290.0, 330.0, 242.0),
        rule_at(350.0, 370.0, 242.0),
    ];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(markdown.contains(r"\frac{a}{x}"), "got: {markdown}");
    assert!(markdown.contains(r"\frac{b}{y}"), "got: {markdown}");
    assert!(markdown.contains(r"\frac{c}{z}"), "got: {markdown}");
    let frac_lines: Vec<&str> = markdown.lines().filter(|l| l.contains(r"\frac")).collect();
    assert_eq!(
        frac_lines.len(),
        1,
        "all three belong to one line: {markdown}"
    );
    // Order is the whole point. Leaving the baseline row unconsumed already
    // gets its content onto this line — `group_blocks` merges the two rows
    // into one display block — but strands it all at the end, reading
    // `\frac{a}{x} \frac{b}{y} \frac{c}{z} + + dz`. Each connector belongs
    // between the two fractions it actually joins, which is knowable only
    // from where it sits relative to the bars.
    assert_eq!(
        frac_lines[0].trim(),
        r"\frac{a}{x} + \frac{b}{y} + \frac{c}{z} dz",
        "got: {markdown}"
    );
}

// A page-furniture rule spans the whole text column, so every prose row on
// the page sits "inside" its span — the span test alone cannot reject it, and
// on Analysis_2_Blatt11.pdf the header rule duly swallowed the sheet's title
// and its first paragraph as a numerator/denominator pair. What separates the
// two is width: a fraction bar spans one term, a separator spans the column.
#[test]
fn a_full_width_separator_rule_is_not_a_fraction_bar() {
    let mut chars = set("11. Ubungsblatt", 72.0, 750.0, Style::default());
    chars.extend(set(
        "1. Berechnen Sie das komplexe Kurvenintegral",
        72.0,
        720.0,
        Style::default(),
    ));
    // As wide as the text column itself, sitting between the two rows.
    let rules = [rule_at(70.0, 290.0, 737.0)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(!markdown.contains(r"\frac"), "got: {markdown}");
}

// LaTeX right-aligns a numbered equation's "(1)" on the equation's own
// baseline, so it arrives as a text piece on a display-maths line. Found on
// Ue1.pdf: it came out as `$...$(1)`, glued onto the equation, and the
// equation itself fell out of its own display block into the paragraph.
#[test]
fn an_equation_number_becomes_a_tag_on_the_display_equation() {
    let mut chars = page_at(900.0, &["Beispiel 1.5. Die Formel"]);
    chars.extend(set("n(n+1)", 300.0, 850.0, maths_italic()));
    chars.extend(set("1+2+3+n =", 200.0, 843.0, maths_italic()));
    chars.extend(set("(1)", 480.0, 843.0, Style::default()));
    chars.extend(set("2", 315.0, 836.0, maths_italic()));
    chars.extend(page_at(800.0, &["lässt sich auch nachweisen"]));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains(r"\tag{1}"), "got: {markdown}");
    assert!(!markdown.contains("$(1)"), "got: {markdown}");
}

// Same numbered equation with a drawn fraction bar (Ue1.pdf for real): the
// ruled-fraction pass builds its own line, which must not lose its display
// status to the "(1)" sitting on the baseline.
#[test]
fn an_equation_number_beside_a_ruled_fraction_keeps_the_equation_display() {
    let mut chars = page_at(900.0, &["Beispiel 1.5. Die Formel"]);
    chars.extend(set("n(n+1)", 300.0, 850.0, maths_italic()));
    chars.extend(set("1+2+3+n =", 200.0, 843.0, maths_italic()));
    chars.extend(set("(1)", 480.0, 843.0, Style::default()));
    chars.extend(set("2", 315.0, 836.0, maths_italic()));
    chars.extend(page_at(800.0, &["lässt sich auch nachweisen"]));
    let rules = [rule_at(298.0, 332.0, 845.0)];

    let markdown = chars_and_rules_to_markdown(&chars, &rules);

    assert!(
        markdown.contains(r"\frac{n(n+1)}{2} \tag{1}"),
        "got: {markdown}"
    );
}
