//! Splits a page's characters into regions in reading order before the
//! existing line/block pipeline sees them, so a multi-column page is read
//! top-to-bottom-then-left-to-right instead of every character on the page
//! being sorted by `y` then `x` with no notion of a column at all.
//!
//! Deliberately free of pdfium types, exactly like [`super::layout`] — pure
//! `CharBox` geometry, fully unit-testable without the native library.

use super::layout::{self, CharBox};

// How close in `y` two characters must sit to share a row-run, scaled by
// font size — the same idea `layout.rs`'s own `BASELINE_TOLERANCE` uses,
// duplicated rather than shared: this module's row-runs only need to be
// good enough to measure geometry for column/band decisions, not to
// correctly attach superscripts to their base row the way `group_lines`'s
// real row-building does.
const ROW_BASELINE_TOLERANCE: f32 = 0.4;
// A candidate column gutter must be at least this many ems of the region's
// dominant font size wide. Also used to decide when a horizontal gap
// between characters sharing one baseline is wide enough to mean "these
// are two different columns", not "these are two words" — see the plan's
// "A note on same-baseline columns".
const MIN_GUTTER_EMS: f32 = 1.5;
// A gutter must be crossed by (i.e. have on each side) at least this many
// distinct row-runs before it counts as a real column boundary. This is
// what stops a stacked fraction's numerator/denominator gap — at most 2-3
// rows tall — from ever being mistaken for a column.
const MIN_CROSSING_ROWS: usize = 4;
// The narrowest gutter actually used to cut columns must be at least this
// many times wider than the next-best candidate not used, or picking it
// would be a guess rather than a measurement — mirrors
// `layout.rs::split_into_terms`'s own `1.5` dominance guard.
const GUTTER_DOMINANCE_RATIO: f32 = 1.5;
// The resulting columns' content widths must be within this ratio of one
// another. Guards against an unequal-width sidebar layout, which is out of
// scope (see the design spec's Non-goals).
const COLUMN_WIDTH_SIMILARITY: f32 = 1.6;
// At most this many gutters are ever cut in one pass — i.e. at most 3
// columns, not a shape course material takes beyond that.
const MAX_COLUMN_CUTS: usize = 2;
// A vertical gap this many multiples of the surrounding rows' font size
// apart is a candidate band boundary — a structural break (a header above
// a multi-column body), not ordinary line or paragraph spacing.
const BAND_GAP_EMS: f32 = 3.0;

fn median(values: &mut [f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[(values.len() - 1) / 2]
}

/// Groups `chars` into row-runs: first by shared baseline, then split
/// further wherever a horizontal gap between consecutive characters on
/// that baseline is gutter-scale. See the plan's "A note on same-baseline
/// columns" for why the second pass is necessary — two columns typeset
/// with matching line spacing routinely share a baseline, and a naive
/// baseline-only grouping would erase the gutter between them before
/// gutter detection ever ran.
pub(super) fn rough_rows(chars: &[CharBox]) -> Vec<Vec<CharBox>> {
    group_by_baseline(chars)
        .into_iter()
        .flat_map(|group| split_by_horizontal_gap(&group))
        .collect()
}

fn group_by_baseline(chars: &[CharBox]) -> Vec<Vec<CharBox>> {
    let mut sorted: Vec<CharBox> = chars.to_vec();
    sorted.sort_by(|a, b| {
        b.y.partial_cmp(&a.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut groups: Vec<Vec<CharBox>> = Vec::new();
    for ch in sorted {
        let same_baseline = groups.last().is_some_and(|g: &Vec<CharBox>| {
            let scale = g[0].font_size.max(ch.font_size).max(1.0);
            (g[0].y - ch.y).abs() <= scale * ROW_BASELINE_TOLERANCE
        });
        match groups.last_mut() {
            Some(g) if same_baseline => g.push(ch),
            _ => groups.push(vec![ch]),
        }
    }
    groups
}

/// Splits one baseline-level group into separate row-runs wherever the gap
/// to the next character (sorted left to right) is at least
/// `MIN_GUTTER_EMS` of the group's own font size — the same scale
/// `try_column_split` itself judges a real column gutter by, so an
/// ordinary line of prose (whose widest gap is an ordinary word-space)
/// never gets split, while two columns sharing a baseline do.
fn split_by_horizontal_gap(group: &[CharBox]) -> Vec<Vec<CharBox>> {
    let mut sorted: Vec<CharBox> = group.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    let mut sizes: Vec<f32> = sorted.iter().map(|c| c.font_size).collect();
    let threshold = median(&mut sizes).max(1.0) * MIN_GUTTER_EMS;

    let mut runs: Vec<Vec<CharBox>> = Vec::new();
    for ch in sorted {
        let gap = runs
            .last()
            .and_then(|r: &Vec<CharBox>| r.last())
            .map(|prev: &CharBox| (ch.x - (prev.x + prev.width)).max(0.0));
        match gap {
            Some(g) if g <= threshold => {
                if let Some(run) = runs.last_mut() {
                    run.push(ch);
                }
            }
            _ => runs.push(vec![ch]),
        }
    }
    runs
}

/// The horizontal span of every row combined — left edge of the leftmost
/// row, right edge of the rightmost.
pub(super) fn region_extent(rows: &[Vec<CharBox>]) -> (f32, f32) {
    rows.iter()
        .map(|r| layout::row_x_extent(r))
        .fold((f32::MAX, f32::MIN), |(lo, hi), (x0, x1)| (lo.min(x0), hi.max(x1)))
}

/// The region's dominant font size, read off its rows' own font sizes.
pub(super) fn region_font_size(rows: &[Vec<CharBox>]) -> f32 {
    let mut sizes: Vec<f32> = rows.iter().map(|r| layout::row_font_size(r)).collect();
    median(&mut sizes)
}

/// Collects every row's characters into one `Vec`, in no particular order —
/// `layout::group_lines` re-sorts by geometry internally regardless, so the
/// order this hands back never matters to its caller.
pub(super) fn flatten(rows: &[Vec<CharBox>]) -> Vec<CharBox> {
    rows.iter().flatten().copied().collect()
}

/// The gaps left over once every row's horizontal span is merged into the
/// region's covered x-ranges — candidate column gutters. A gutter here is
/// never crossed by any row's own extent, by construction: rows only ever
/// span multiple columns when `split_by_horizontal_gap` failed to separate
/// them, which is exactly the failure mode Task 1 exists to prevent.
fn column_gutters(rows: &[Vec<CharBox>]) -> Vec<(f32, f32)> {
    let mut intervals: Vec<(f32, f32)> = rows
        .iter()
        .map(|r| layout::row_x_extent(r))
        .filter(|(x0, x1)| x0 <= x1)
        .collect();
    intervals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut merged: Vec<(f32, f32)> = Vec::new();
    for (s, e) in intervals {
        match merged.last_mut() {
            Some((_, last_e)) if s <= *last_e => *last_e = last_e.max(e),
            _ => merged.push((s, e)),
        }
    }
    merged.windows(2).map(|w| (w[0].1, w[1].0)).collect()
}

/// Attempts to split `rows` into 2 or 3 left-to-right columns. `None` when
/// there's no gutter confident enough to act on: too few rows to judge, no
/// gap wide enough, an ambiguous choice among several equally-wide gaps, or
/// halves that don't come out balanced. Every guard here is deliberately
/// conservative — see the plan's Global Constraints for why.
pub(super) fn try_column_split(rows: &[Vec<CharBox>]) -> Option<Vec<Vec<Vec<CharBox>>>> {
    if rows.len() < MIN_CROSSING_ROWS * 2 {
        return None;
    }

    let body_size = region_font_size(rows).max(1.0);
    let mut candidates: Vec<(f32, f32, f32)> = column_gutters(rows)
        .into_iter()
        .map(|(g0, g1)| (g1 - g0, g0, g1))
        .filter(|(width, _, _)| *width >= body_size * MIN_GUTTER_EMS)
        .collect();
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let take = candidates.len().min(MAX_COLUMN_CUTS);
    let cuts = &candidates[..take];
    if let Some((next_width, _, _)) = candidates.get(take) {
        let narrowest_kept = cuts.iter().map(|(w, _, _)| *w).fold(f32::INFINITY, f32::min);
        if narrowest_kept <= next_width * GUTTER_DOMINANCE_RATIO {
            return None;
        }
    }

    let mut cut_xs: Vec<f32> = cuts.iter().map(|(_, g0, g1)| (g0 + g1) / 2.0).collect();
    cut_xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let mut columns: Vec<Vec<Vec<CharBox>>> = vec![Vec::new(); cut_xs.len() + 1];
    for row in rows {
        let (x0, _) = layout::row_x_extent(row);
        let column = cut_xs.iter().filter(|&&cx| x0 > cx).count();
        columns[column].push(row.clone());
    }

    if columns.iter().any(|c| c.len() < MIN_CROSSING_ROWS) {
        return None;
    }

    let widths: Vec<f32> = columns
        .iter()
        .map(|c| {
            let (x0, x1) = region_extent(c);
            x1 - x0
        })
        .collect();
    let max_w = widths.iter().cloned().fold(f32::MIN, f32::max);
    let min_w = widths.iter().cloned().fold(f32::MAX, f32::min);
    if min_w <= 0.0 || max_w / min_w > COLUMN_WIDTH_SIMILARITY {
        return None;
    }

    Some(columns)
}

/// Splits `rows` (already top-to-bottom) into contiguous bands wherever
/// consecutive rows sit further apart than `BAND_GAP_EMS` multiples of
/// their font size — clearly larger than ordinary line or paragraph
/// spacing, the shape a genuine structural break (a header above a
/// multi-column body) takes.
pub(super) fn split_into_bands(rows: &[Vec<CharBox>]) -> Vec<Vec<Vec<CharBox>>> {
    if rows.is_empty() {
        return Vec::new();
    }
    let mut bands: Vec<Vec<Vec<CharBox>>> = Vec::new();
    let mut current: Vec<Vec<CharBox>> = vec![rows[0].clone()];
    for pair in rows.windows(2) {
        let (prev, next) = (&pair[0], &pair[1]);
        let size = layout::row_font_size(prev).max(layout::row_font_size(next)).max(1.0);
        let gap = layout::row_y(prev) - layout::row_y(next);
        if gap > size * BAND_GAP_EMS {
            bands.push(std::mem::take(&mut current));
        }
        current.push(next.clone());
    }
    bands.push(current);
    bands
}

/// Splits a page's characters into regions in reading order — bands
/// top-to-bottom, columns left-to-right within a band — so
/// `layout::chars_to_markdown` can process each region as though it were
/// its own small page.
///
/// A page with no multi-column structure at all always produces exactly
/// one region holding every character: if neither the whole page nor any
/// individual band produces a confident column split, this returns the
/// whole page as a single region rather than fragmenting an ordinary
/// single-column document at whatever paragraph-scale gaps happen to
/// cross `BAND_GAP_EMS`. That fallback is what guarantees today's
/// single-column behavior is unchanged.
pub fn segment_regions(chars: &[CharBox]) -> Vec<Vec<CharBox>> {
    if chars.is_empty() {
        return Vec::new();
    }
    let rows = rough_rows(chars);

    if let Some(columns) = try_column_split(&rows) {
        return columns.iter().map(|c| flatten(c)).collect();
    }

    let bands = split_into_bands(&rows);
    let band_columns: Vec<Option<Vec<Vec<Vec<CharBox>>>>> =
        bands.iter().map(|b| try_column_split(b)).collect();

    if band_columns.iter().all(Option::is_none) {
        return vec![flatten(&rows)];
    }

    bands
        .iter()
        .zip(band_columns)
        .flat_map(|(band_rows, columns)| match columns {
            Some(cols) => cols.iter().map(|c| flatten(c)).collect::<Vec<_>>(),
            None => vec![flatten(band_rows)],
        })
        .collect()
}
