# PDF Multi-Column Reading Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Read multi-column PDFs (whole-page N-column layouts, and pages that mix a full-width band with a multi-column band) in correct top-to-bottom-then-left-to-right reading order, instead of today's behavior — `pdf::layout::group_lines` sorts every character on the page by `y` then `x` with no notion of columns, so same-baseline left- and right-column text merges into one garbled row.

**Architecture:** A new `src-tauri/src/pdf/columns.rs` module, pure `CharBox` geometry like `layout.rs` (no pdfium dependency). Its one public entry point, `segment_regions(chars: &[CharBox]) -> Vec<Vec<CharBox>>`, is called once per page from `extract.rs::pages_to_markdown`, before the existing `layout::chars_to_markdown`. Each returned region is fed through the existing, unmodified layout pipeline independently, and the rendered Markdown is concatenated in the order the regions were returned — the same join `pages_to_markdown` already does between pages. A page with no multi-column structure always produces exactly one region (the whole page), which is what makes today's single-column behavior a provable special case of the new code path.

**Tech Stack:** Rust, new `src-tauri/src/pdf/columns.rs` (+ test module `columns_tests.rs`), one call-site change in `src-tauri/src/pdf/extract.rs`. No new dependencies.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `columns.rs` must stay free of any `pdfium` dependency, exactly like `layout.rs` — everything here is pure `CharBox` geometry, so the whole module is unit-testable without the native library.
- `cargo clippy -- -D warnings` must pass clean before this is done.
- Every threshold in this design is deliberately conservative: **a single-column page must always produce exactly one region.** Under-detecting a genuine multi-column page reproduces today's known garbled-but-familiar failure mode; over-detecting on a single-column page would be a regression on the common case. When in doubt, the code must fall back to one region.
- Real-document verification is required before this feature is described as working, per the spec (`docs/specs/pdf-multi-column-reading-order-design.md`) and this pipeline's own standing experience ("every bug found so far was invisible in synthetic fixtures alone" — `CLAUDE.md`). No multi-column PDF exists in `notes/` yet, so Task 5's verification step is explicitly blocked until one is provided — implementation and the synthetic test suite proceed regardless, but the feature is not claimed to work on real documents until checked.
- Small diffs. Do not touch `layout.rs`, `latex.rs`, `maths.rs`, or `reconstruct_fractions`/`reconstruct_fraction_sums` — this module composes with the existing pipeline at the `chars_to_markdown` boundary only.

---

## Background

`pdf::layout::group_lines` (`src-tauri/src/pdf/layout.rs:537`) takes a page's entire `Vec<CharBox>`, sorts by `y` (descending) then `x`, and groups into rows purely by baseline (`y`) tolerance — there is no x-distance limit on what counts as "the same row". On a two-column page, left- and right-column characters that happen to sit at the same baseline get grouped into one row and rendered as glued-together garbage. `extract.rs` confirms there's no column-awareness anywhere upstream either.

## A note on same-baseline columns

A naive fix — group characters into rows by `y`-tolerance only, then look for a horizontal gutter in the union of each row's x-extent — does not work: two columns whose text happens to share a baseline (the overwhelmingly common case, since columns are typically typeset with matching line spacing) get merged into **one** row spanning nearly the full page width before gutter detection ever runs, silently erasing the very gap this module exists to find. Task 1 below groups by baseline first, then splits **each baseline-level group** further wherever a horizontal gap between consecutive characters is gutter-scale — so two columns sharing a baseline become two separate row-runs, while an ordinary line of prose (whose only gaps are ordinary word-spaces, far below gutter scale) stays as one row.

---

### Task 1: Row-run construction and small geometry helpers

**Files:**
- Create: `src-tauri/src/pdf/columns.rs`
- Create: `src-tauri/src/pdf/columns_tests.rs`
- Modify: `src-tauri/src/pdf/mod.rs` (register both new modules)

**Interfaces:**
- Consumes: `layout::CharBox` (existing, `src-tauri/src/pdf/layout.rs`), `layout::row_x_extent`, `layout::row_y`, `layout::row_font_size` (existing `pub(super)` fns, same file, reused as-is).
- Produces: `pub(super) fn rough_rows(chars: &[CharBox]) -> Vec<Vec<CharBox>>`, `pub(super) fn region_extent(rows: &[Vec<CharBox>]) -> (f32, f32)`, `pub(super) fn region_font_size(rows: &[Vec<CharBox>]) -> f32`, `pub(super) fn flatten(rows: &[Vec<CharBox>]) -> Vec<CharBox>` — all used by Tasks 2-4.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/pdf/columns_tests.rs`:

```rust
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
    let texts: Vec<String> = rows.iter().map(|r| r.iter().map(|c| c.ch).collect()).collect();
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
    let rows = vec![line("left", 100.0, 700.0), line("right side", 300.0, 680.0)];
    let (x0, x1) = region_extent(&rows);
    assert_eq!(x0, 100.0);
    assert_eq!(x1, 300.0 + "right side".chars().count() as f32 * BODY * ADVANCE);
}

#[test]
fn flatten_collects_every_row_into_one_vec() {
    let rows = vec![line("a", 100.0, 700.0), line("b", 100.0, 680.0)];
    assert_eq!(flatten(&rows).len(), 2);
}

#[test]
fn rough_rows_on_empty_input_is_empty() {
    assert_eq!(rough_rows(&[]), Vec::<Vec<CharBox>>::new());
}
```

- [ ] **Step 2: Run tests to verify they fail to compile**

Run (from `src-tauri/`): `cargo test --package null-notes columns_tests`
Expected: FAIL to compile — `columns` module does not exist yet.

- [ ] **Step 3: Create the module and implement**

Create `src-tauri/src/pdf/columns.rs`:

```rust
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
```

Modify `src-tauri/src/pdf/mod.rs` — add `pub mod columns;` and `#[cfg(test)] mod columns_tests;`, matching the existing `layout`/`layout_tests` pattern:

```rust
pub mod columns;
pub mod extract;
pub mod layout;
pub mod latex;
pub mod maths;
pub mod models;
pub mod renderer;

#[cfg(test)]
mod columns_tests;
#[cfg(test)]
mod dump;
#[cfg(test)]
mod layout_tests;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes columns_tests`
Expected: PASS — all six tests, including `same_baseline_columns_split_into_separate_row_runs`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/columns.rs src-tauri/src/pdf/columns_tests.rs src-tauri/src/pdf/mod.rs
git commit -m "feat(pdf): add row-run construction for multi-column segmentation"
```

---

### Task 2: `column_gutters` and `try_column_split`

**Files:**
- Modify: `src-tauri/src/pdf/columns.rs` (add after `flatten`)
- Test: `src-tauri/src/pdf/columns_tests.rs`

**Interfaces:**
- Consumes: `region_extent`, `region_font_size`, `median` (Task 1, same file), `layout::row_x_extent` (existing).
- Produces: `pub(super) fn try_column_split(rows: &[Vec<CharBox>]) -> Option<Vec<Vec<Vec<CharBox>>>>` — used by Task 4. Each element of the returned `Vec` is one column's rows, left to right.

- [ ] **Step 1: Write the failing tests**

Add to `columns_tests.rs`:

```rust
#[test]
fn splits_two_evenly_spaced_columns() {
    let mut rows: Vec<Vec<CharBox>> = Vec::new();
    for i in 0..5 {
        let y = 700.0 - i as f32 * 12.0;
        rows.push(line("left column text", 72.0, y));
        rows.push(line("right column text", 320.0, y));
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
    let mut rows: Vec<Vec<CharBox>> = Vec::new();
    for i in 0..5 {
        let y = 700.0 - i as f32 * 12.0;
        rows.push(line("first col", 72.0, y));
        rows.push(line("second col", 300.0, y));
        rows.push(line("third col", 520.0, y));
    }

    let columns = try_column_split(&rows).expect("expected a confident 3-way split");

    assert_eq!(columns.len(), 3);
    assert!(columns.iter().all(|c| c.len() == 5));
}

#[test]
fn refuses_a_split_when_theres_no_gap_at_all() {
    let rows: Vec<Vec<CharBox>> = (0..8)
        .map(|i| line("ordinary prose line goes right here", 72.0, 700.0 - i as f32 * 12.0))
        .collect();
    assert_eq!(try_column_split(&rows), None);
}

// Mimics a stacked fraction's numerator/denominator: an isolated pair of
// short rows sitting apart from a wide block of ordinary column rows —
// nowhere near enough rows on the narrow side to count as a real second
// column. This is the guard that keeps equation reconstruction untouched.
#[test]
fn refuses_a_split_when_one_side_has_too_few_rows() {
    let mut rows: Vec<Vec<CharBox>> = Vec::new();
    for i in 0..6 {
        rows.push(line("a wide paragraph line here", 72.0, 700.0 - i as f32 * 12.0));
    }
    rows.push(line("num", 400.0, 700.0));
    rows.push(line("den", 400.0, 688.0));

    assert_eq!(try_column_split(&rows), None);
}

#[test]
fn refuses_a_split_when_columns_are_very_unequal_width() {
    let mut rows: Vec<Vec<CharBox>> = Vec::new();
    for i in 0..5 {
        let y = 700.0 - i as f32 * 12.0;
        rows.push(line("a very long wide body paragraph line", 72.0, y));
        rows.push(line("sb", 500.0, y));
    }
    assert_eq!(try_column_split(&rows), None);
}

#[test]
fn refuses_a_split_when_too_many_gutters_are_equally_wide() {
    // Four evenly-spaced blocks make three equally-wide gutters.
    // MAX_COLUMN_CUTS only allows keeping 2, and none of the three
    // candidates stands out as clearly the right ones to keep.
    let mut rows: Vec<Vec<CharBox>> = Vec::new();
    for i in 0..5 {
        let y = 700.0 - i as f32 * 12.0;
        rows.push(line("aa", 72.0, y));
        rows.push(line("aa", 172.0, y));
        rows.push(line("aa", 272.0, y));
        rows.push(line("aa", 372.0, y));
    }
    assert_eq!(try_column_split(&rows), None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package null-notes columns_tests`
Expected: FAIL to compile — `try_column_split` and `column_gutters` don't exist yet.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/pdf/columns.rs`, after `flatten`:

```rust
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

    let widths: Vec<f32> = columns.iter().map(|c| {
        let (x0, x1) = region_extent(c);
        x1 - x0
    }).collect();
    let max_w = widths.iter().cloned().fold(f32::MIN, f32::max);
    let min_w = widths.iter().cloned().fold(f32::MAX, f32::min);
    if min_w <= 0.0 || max_w / min_w > COLUMN_WIDTH_SIMILARITY {
        return None;
    }

    Some(columns)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes columns_tests`
Expected: PASS — all tests from Task 1 and Task 2.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/columns.rs src-tauri/src/pdf/columns_tests.rs
git commit -m "feat(pdf): add gutter-based column splitting"
```

---

### Task 3: `split_into_bands`

**Files:**
- Modify: `src-tauri/src/pdf/columns.rs` (add after `try_column_split`)
- Test: `src-tauri/src/pdf/columns_tests.rs`

**Interfaces:**
- Consumes: `layout::row_y`, `layout::row_font_size` (existing).
- Produces: `pub(super) fn split_into_bands(rows: &[Vec<CharBox>]) -> Vec<Vec<Vec<CharBox>>>` — used by Task 4. `rows` must already be in top-to-bottom order, which is `rough_rows`'s own output order.

- [ ] **Step 1: Write the failing tests**

Add to `columns_tests.rs`:

```rust
#[test]
fn splits_into_bands_wherever_the_gap_exceeds_the_threshold() {
    let rows = vec![
        line("header", 72.0, 700.0),
        line("body one", 72.0, 688.0),
        line("body two", 72.0, 676.0),
        // Gap of 40pt from the previous row — well above
        // BAND_GAP_EMS(3.0) * 10pt = 30pt.
        line("footer", 72.0, 636.0),
    ];
    let bands = split_into_bands(&rows);
    assert_eq!(bands.len(), 2);
    assert_eq!(bands[0].len(), 3);
    assert_eq!(bands[1].len(), 1);
}

#[test]
fn ordinary_line_spacing_stays_in_one_band() {
    let rows: Vec<Vec<CharBox>> =
        (0..5).map(|i| line("line", 72.0, 700.0 - i as f32 * 12.0)).collect();
    assert_eq!(split_into_bands(&rows).len(), 1);
}

#[test]
fn an_empty_row_list_produces_no_bands() {
    assert_eq!(split_into_bands(&[]), Vec::<Vec<Vec<CharBox>>>::new());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package null-notes columns_tests`
Expected: FAIL to compile — `split_into_bands` doesn't exist yet.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/pdf/columns.rs`, after `try_column_split`:

```rust
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes columns_tests`
Expected: PASS — all tests from Tasks 1-3.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/columns.rs src-tauri/src/pdf/columns_tests.rs
git commit -m "feat(pdf): add band splitting for mixed single/multi-column pages"
```

---

### Task 4: `segment_regions` orchestration, wired into `extract.rs`

**Files:**
- Modify: `src-tauri/src/pdf/columns.rs` (add `segment_regions` after `split_into_bands`, made fully `pub`)
- Modify: `src-tauri/src/pdf/extract.rs` (wire into `pages_to_markdown`)
- Test: `src-tauri/src/pdf/columns_tests.rs`

**Interfaces:**
- Consumes: `rough_rows`, `flatten` (Task 1), `try_column_split` (Task 2), `split_into_bands` (Task 3) — all same-file.
- Produces: `pub fn segment_regions(chars: &[CharBox]) -> Vec<Vec<CharBox>>` — called from `extract.rs`.

- [ ] **Step 1: Write the failing integration tests**

Add to `columns_tests.rs`:

```rust
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
    // Wide enough to bridge past both columns below it (72 to ~447), so
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package null-notes columns_tests`
Expected: FAIL to compile — `segment_regions` doesn't exist yet.

- [ ] **Step 3: Implement and wire in**

Add to `src-tauri/src/pdf/columns.rs`, after `split_into_bands`:

```rust
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
```

Modify `src-tauri/src/pdf/extract.rs`. Find the import line near the top:

```rust
use super::layout::{self, CharBox};
```

Replace with:

```rust
use super::columns;
use super::layout::{self, CharBox};
```

Find `pages_to_markdown`:

```rust
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
```

Replace with:

```rust
pub fn pages_to_markdown(pages: &[ExtractedPage]) -> String {
    let mut chunks: Vec<String> = Vec::new();
    for page in pages {
        for region in columns::segment_regions(&page.chars) {
            let markdown = layout::chars_to_markdown(&region);
            if !markdown.trim().is_empty() {
                chunks.push(markdown.trim_end().to_string());
            }
        }
    }
    let mut out = chunks.join("\n\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cargo test --package null-notes columns_tests`
Expected: PASS — all tests from Tasks 1-4.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run (from `src-tauri/`): `cargo test --package null-notes`
Expected: PASS — every existing `pdf::extract`/`pdf::layout` test still passes unmodified, including `extract.rs`'s own `pages_are_concatenated_into_one_document` and `a_blank_page_does_not_leave_a_hole_in_the_document` (these build single-row-per-page fixtures, which `segment_regions` reduces to one region each, reproducing the exact prior output). If anything regresses, stop and re-examine — do not loosen a guard in `try_column_split` to make a test pass without understanding why the guard fired.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/columns.rs src-tauri/src/pdf/columns_tests.rs src-tauri/src/pdf/extract.rs
git commit -m "feat(pdf): wire multi-column segmentation into page-to-markdown"
```

---

### Task 5: Clippy and real-document verification

**Files:** none (verification only).

- [ ] **Step 1: Run clippy**

From `src-tauri/`: `cargo clippy -- -D warnings`
Expected: clean. Fix anything flagged in `columns.rs`/`extract.rs` before moving on.

- [ ] **Step 2: Commit any clippy fixups, if needed**

```bash
git add src-tauri/src/pdf/columns.rs src-tauri/src/pdf/extract.rs
git commit -m "fix(pdf): address clippy warnings in column segmentation"
```

(Skip this commit entirely if Step 1 was already clean.)

- [ ] **Step 3: Real-document verification — BLOCKED, do not skip silently**

No multi-column PDF exists in `notes/` at the time this plan was written. This step cannot be completed yet. Do not mark this feature as working on real documents, and do not close out this plan as fully done, until:

1. A real multi-column PDF (a two-column paper, lecture slides, or a handout with a full-width header over a multi-column body) is added to `notes/`.
2. `NULL_NOTES_PDF=../notes/<file>.pdf cargo test --package null-notes dump_markdown -- --ignored --nocapture` (run from `src-tauri/`) is checked by hand: reading order must be correct top-to-bottom-then-left-to-right, and no other page in `notes/` (the existing single-column worksheets) should show any change in output versus before this plan.
3. If detection is wrong on the real document — either a missed split or, worse, a false-positive split on what should have been one column — this is a new root-cause investigation against real geometry (via `dump_line_pieces`/`dump_render_page0` in `dump.rs`), not a threshold-tuning exercise on the synthetic fixtures alone.

Once verified, record the outcome (and any threshold changes it required) as a follow-up commit; this task's checklist item stays unchecked until that happens.
