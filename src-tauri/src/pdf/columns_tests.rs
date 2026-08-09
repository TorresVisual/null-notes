//! Tests for multi-column/band page segmentation. Built on the same tiny
//! typesetter idea `layout_tests.rs` uses — no pdfium involved, everything
//! here is plain `CharBox` geometry.

use super::columns::*;
use super::layout::{self, CharBox};
use super::maths::Family;

const BODY: f32 = 10.0;
// Roughly a Times-ish advance; only the ratio to font_size matters.
const ADVANCE: f32 = 0.5;

#[derive(Clone, Copy)]
struct Style {
    size: f32,
}

impl Default for Style {
    fn default() -> Self {
        Style { size: BODY }
    }
}

/// Lays one run of text out at (x, y), left to right.
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
            top: y + style.size * 0.75,
            bottom: y - style.size * 0.25,
            font_size: style.size,
            bold: false,
            italic: false,
            fixed_pitch: false,
            family: Family::Text,
        });
        cursor += width;
    }
    out
}

fn line(text: &str, x: f32, y: f32) -> Vec<CharBox> {
    set(text, x, y, Style::default())
}

/// Tags a hand-built row with a local stream index, the shape every row
/// carries once it comes out of `rough_rows` — the functions under test
/// here no longer accept bare `CharBox` rows, since losing that tag is
/// exactly the bug `flatten`'s regression test below guards against.
fn indexed(row: Vec<CharBox>) -> Vec<(usize, CharBox)> {
    row.into_iter().enumerate().collect()
}

#[test]
fn an_ordinary_line_of_prose_stays_one_row() {
    let chars = line("an ordinary line of single column prose", 72.0, 700.0);
    let rows = rough_rows(&chars);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].len(), chars.len());
}

// The critical regression-fix case: two columns typeset with matching line
// spacing share a baseline. A naive baseline-only grouping would merge them
// into one row spanning the whole page width, erasing the gutter before
// gutter detection ever runs — see "A note on same-baseline columns" in the
// plan. The gap between "left column text" (ending ~x=147) and the right
// run starting at x=320 is 173pt, far past any ordinary word gap.
#[test]
fn same_baseline_columns_split_into_separate_row_runs() {
    let mut chars = line("left column text", 72.0, 700.0);
    chars.extend(line("right column text", 320.0, 700.0));

    let rows = rough_rows(&chars);

    assert_eq!(rows.len(), 2);
    let texts: Vec<String> = rows.iter().map(|r| r.iter().map(|(_, c)| c.ch).collect()).collect();
    assert_eq!(texts, ["left column text", "right column text"]);
}

#[test]
fn different_baselines_never_merge() {
    let mut chars = line("top line", 72.0, 700.0);
    chars.extend(line("bottom line", 72.0, 680.0));
    let rows = rough_rows(&chars);
    assert_eq!(rows.len(), 2);
}

#[test]
fn region_extent_spans_every_row() {
    let rows = vec![indexed(line("left", 100.0, 700.0)), indexed(line("right side", 300.0, 680.0))];
    let (x0, x1) = region_extent(&rows);
    assert_eq!(x0, 100.0);
    assert_eq!(x1, 300.0 + "right side".chars().count() as f32 * BODY * ADVANCE);
}

#[test]
fn flatten_collects_every_row_into_one_vec() {
    let rows = vec![indexed(line("a", 100.0, 700.0)), indexed(line("b", 100.0, 680.0))];
    assert_eq!(flatten(&rows).len(), 2);
}

#[test]
fn rough_rows_on_empty_input_is_empty() {
    assert_eq!(rough_rows(&[]), Vec::<Vec<(usize, CharBox)>>::new());
}

// The real bug: `rough_rows` regroups characters by baseline/gutter
// geometry, which is not the page's own extraction-stream order. A raised
// superscript prime sits far enough above its base letter's baseline to
// land in a *different*, earlier-sorted baseline group — `flatten` must
// still hand characters back in their original stream order, not row-run
// order, or `layout::build_line` (which trusts that order over `x`)
// silently swaps the prime ahead of the letter it modifies. Found on
// Analysis_2_Blatt12.pdf: "y'(t) + 2y(t) = 4cos(2t)" imported as
// "'y(t) + 2y(t) = 4cos(2t))".
#[test]
fn flatten_preserves_original_stream_order_across_a_raised_superscript() {
    let mut chars = set("y", 100.0, 700.0, Style::default());
    let prime_x = chars.last().map(|c| c.x + c.width).unwrap_or(100.0);
    chars.push(CharBox {
        ch: '\'',
        x: prime_x,
        y: 706.0,
        width: 2.0,
        top: 710.0,
        bottom: 704.0,
        font_size: 7.0,
        bold: false,
        italic: false,
        fixed_pitch: false,
        family: Family::Text,
    });
    chars.extend(set("(t)", prime_x + 2.0, 700.0, Style::default()));

    let regions = segment_regions(&chars);

    assert_eq!(regions.len(), 1);
    let order: Vec<char> = regions[0].iter().map(|c| c.ch).collect();
    let expected: Vec<char> = chars.iter().map(|c| c.ch).collect();
    assert_eq!(order, expected);
}

#[test]
fn splits_two_evenly_spaced_columns() {
    let mut rows: Vec<Vec<(usize, CharBox)>> = Vec::new();
    for i in 0..5 {
        let y = 700.0 - i as f32 * 12.0;
        rows.push(indexed(line("left column text", 72.0, y)));
        rows.push(indexed(line("right column text", 320.0, y)));
    }

    let columns = try_column_split(&rows).expect("expected a confident 2-way split");

    assert_eq!(columns.len(), 2);
    assert_eq!(columns[0].len(), 5);
    assert_eq!(columns[1].len(), 5);
    let (left_x0, _) = region_extent(&columns[0]);
    let (right_x0, _) = region_extent(&columns[1]);
    assert!(left_x0 < right_x0);
}

#[test]
fn splits_three_columns_when_two_gutters_clearly_dominate() {
    let mut rows: Vec<Vec<(usize, CharBox)>> = Vec::new();
    for i in 0..5 {
        let y = 700.0 - i as f32 * 12.0;
        rows.push(indexed(line("first col", 72.0, y)));
        rows.push(indexed(line("second col", 300.0, y)));
        rows.push(indexed(line("third col", 520.0, y)));
    }

    let columns = try_column_split(&rows).expect("expected a confident 3-way split");

    assert_eq!(columns.len(), 3);
    assert!(columns.iter().all(|c| c.len() == 5));
}

#[test]
fn refuses_a_split_when_theres_no_gap_at_all() {
    let rows: Vec<Vec<(usize, CharBox)>> = (0..8)
        .map(|i| indexed(line("ordinary prose line goes right here", 72.0, 700.0 - i as f32 * 12.0)))
        .collect();
    assert_eq!(try_column_split(&rows), None);
}

// Mimics a stacked fraction's numerator/denominator: an isolated pair of
// short rows sitting apart from a wide block of ordinary column rows —
// nowhere near enough rows on the narrow side to count as a real second
// column. This is the guard that keeps equation reconstruction untouched.
#[test]
fn refuses_a_split_when_one_side_has_too_few_rows() {
    let mut rows: Vec<Vec<(usize, CharBox)>> = Vec::new();
    for i in 0..6 {
        rows.push(indexed(line("a wide paragraph line here", 72.0, 700.0 - i as f32 * 12.0)));
    }
    rows.push(indexed(line("num", 400.0, 700.0)));
    rows.push(indexed(line("den", 400.0, 688.0)));

    assert_eq!(try_column_split(&rows), None);
}

#[test]
fn refuses_a_split_when_columns_are_very_unequal_width() {
    let mut rows: Vec<Vec<(usize, CharBox)>> = Vec::new();
    for i in 0..5 {
        let y = 700.0 - i as f32 * 12.0;
        rows.push(indexed(line("a very long wide body paragraph line", 72.0, y)));
        rows.push(indexed(line("sb", 500.0, y)));
    }
    assert_eq!(try_column_split(&rows), None);
}

#[test]
fn refuses_a_split_when_too_many_gutters_are_equally_wide() {
    // Four evenly-spaced blocks make three equally-wide gutters.
    // MAX_COLUMN_CUTS only allows keeping 2, and none of the three
    // candidates stands out as clearly the right ones to keep.
    let mut rows: Vec<Vec<(usize, CharBox)>> = Vec::new();
    for i in 0..5 {
        let y = 700.0 - i as f32 * 12.0;
        rows.push(indexed(line("aa", 72.0, y)));
        rows.push(indexed(line("aa", 172.0, y)));
        rows.push(indexed(line("aa", 272.0, y)));
        rows.push(indexed(line("aa", 372.0, y)));
    }
    assert_eq!(try_column_split(&rows), None);
}

#[test]
fn splits_into_bands_wherever_the_gap_exceeds_the_threshold() {
    let rows = vec![
        indexed(line("header", 72.0, 700.0)),
        indexed(line("body one", 72.0, 688.0)),
        indexed(line("body two", 72.0, 676.0)),
        // Gap of 40pt from the previous row — well above
        // BAND_GAP_EMS(3.0) * 10pt = 30pt.
        indexed(line("footer", 72.0, 636.0)),
    ];
    let bands = split_into_bands(&rows);
    assert_eq!(bands.len(), 2);
    assert_eq!(bands[0].len(), 3);
    assert_eq!(bands[1].len(), 1);
}

#[test]
fn ordinary_line_spacing_stays_in_one_band() {
    let rows: Vec<Vec<(usize, CharBox)>> =
        (0..5).map(|i| indexed(line("line", 72.0, 700.0 - i as f32 * 12.0))).collect();
    assert_eq!(split_into_bands(&rows).len(), 1);
}

#[test]
fn an_empty_row_list_produces_no_bands() {
    assert_eq!(split_into_bands(&[]), Vec::<Vec<Vec<(usize, CharBox)>>>::new());
}

#[test]
fn a_single_column_page_stays_one_region() {
    let mut chars: Vec<CharBox> = Vec::new();
    for i in 0..8 {
        chars.extend(line(
            "an ordinary line of single column prose",
            72.0,
            700.0 - i as f32 * 12.0,
        ));
    }

    let regions = segment_regions(&chars);

    assert_eq!(regions.len(), 1);
    assert_eq!(regions[0].len(), chars.len());
}

#[test]
fn a_whole_page_two_column_layout_becomes_two_regions_left_then_right() {
    let mut chars: Vec<CharBox> = Vec::new();
    for i in 0..6 {
        let y = 700.0 - i as f32 * 12.0;
        chars.extend(line("left column body text", 72.0, y));
        chars.extend(line("right column body text", 320.0, y));
    }

    let regions = segment_regions(&chars);

    assert_eq!(regions.len(), 2);
    let (r0_x0, _) = layout::row_x_extent(&regions[0]);
    let (r1_x0, _) = layout::row_x_extent(&regions[1]);
    assert!(r0_x0 < r1_x0);
}

#[test]
fn a_header_above_a_two_column_body_becomes_three_regions_in_order() {
    let mut chars: Vec<CharBox> = Vec::new();
    // Wide enough to bridge past both columns below it (72 to ~427), so
    // the whole-page gutter is closed and this can only be found by
    // band-splitting the header away first.
    chars.extend(line(
        "the header line stretches all the way across the entire page width here",
        72.0,
        700.0,
    ));
    // 40pt gap from the header — above BAND_GAP_EMS(3.0) * 10pt = 30pt.
    for i in 0..6 {
        let y = 660.0 - i as f32 * 12.0;
        chars.extend(line("left column body text", 72.0, y));
        chars.extend(line("right column body text", 320.0, y));
    }

    let regions = segment_regions(&chars);

    assert_eq!(regions.len(), 3);
    assert!(regions[0].iter().all(|c| c.y == 700.0));
    let (r1_x0, _) = layout::row_x_extent(&regions[1]);
    let (r2_x0, _) = layout::row_x_extent(&regions[2]);
    assert!(r1_x0 < r2_x0);
}

#[test]
fn segment_regions_on_empty_input_is_empty() {
    assert_eq!(segment_regions(&[]), Vec::<Vec<CharBox>>::new());
}
