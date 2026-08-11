# PDF Multi-Fraction Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Correctly reconstruct a *sum of several stacked fractions on one display line* (`1/x² + y²/(x⁴+x³y) + y³/(x⁵-x³y²)`) into clean `\frac{}{}` LaTeX, instead of the garbled, glued-together text the pipeline currently produces for that shape.

**Architecture:** Add a new geometry-driven reconstruction pass, `reconstruct_fraction_sums`, that runs inside `pdf::layout::group_lines`, *before* `build_line` collapses a row's raw `CharBox`es into a `Vec<Inline>`. It detects a "connector baseline" row (an enumeration label like `(b)` followed only by `+`/`-` operators and an optional trailing `.`), locates the numerator row above it and denominator row below it, splits each of those rows into exactly as many terms as the baseline has connectors using the row's own largest horizontal gaps, and emits one finished `Line` per match. Rows nothing matches still go through the existing `build_line` path unchanged, and the pre-existing single-fraction reconstruction (`reconstruct_fractions`, which runs later on the finished `Vec<Line>`) is untouched, so it keeps handling the `N = 1` case exactly as it does today.

**Tech Stack:** Rust, `src-tauri/src/pdf/layout.rs` (+ its test module `layout_tests.rs`), no new dependencies.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `pdf/layout.rs` must stay free of any `pdfium` dependency — this change only touches pure `CharBox`/`Line`/`Inline` logic, already true of everything it builds on.
- `cargo clippy -- -D warnings` must pass clean before this is done.
- Judge the fix against the real document: `NULL_NOTES_PDF=../notes/Analysis_1_Blatt2_2025.pdf cargo test dump_markdown -- --ignored --nocapture`, run from `src-tauri/`. Every existing bug in this pipeline was invisible in synthetic fixtures alone, so synthetic tests are necessary but not sufficient here.
- Small diffs, no incidental refactors — do not touch `reconstruct_fractions`, `maths_runs`, or anything in `latex.rs` beyond calling the existing public `latex::to_latex`.

---

## Background: what's broken and why

Confirmed by rendering the real PDF (`src-tauri/src/pdf/dump.rs`'s `dump_render_page0`/`dump_line_pieces` diagnostics) that exercise 1(b) on `notes/Analysis_1_Blatt2_2025.pdf` reads `1/x² + y²/(x⁴+x³y) + y³/(x⁵-x³y²)`. The pipeline currently extracts it as three raw rows:

```
y=598.96  numerator band:  Text("1 "), Maths("y^2"), Text(" "), Maths("y^3")
y=590.87  baseline band:   Text("(b) + + "), Maths(".")
y=582.67  denominator band: Maths("x^2 x^4 + x^3y x^5 - x^3y^2")   <- all three denominators glued into one string
```

Root causes, all stemming from the same fact — `maths_runs`/`build_line` process one row in isolation with no knowledge of the fraction it's part of:

1. `MATHS_BRIDGE_EMS` (a fixed 2.5em gap threshold in `maths_runs`) correctly keeps the three numerators apart but incorrectly bridges the three denominators into one string — a wider denominator (`x⁴+x³y`) sits closer to its neighbor than the narrower numerator above it does, so the same fixed threshold gives different (and here, wrong) answers on the two rows.
2. A lone digit numerator (`1`) carries no font-family signal, so it's classified as body text rather than maths and is invisible to any fraction-detection that keys off `Inline::Maths`.
3. The `+`/`-` connectors between fraction terms land on the label row and get absorbed into its `Text` span (`"(b) + + "`), rather than staying identifiable as tokens between fractions.
4. `reconstruct_fractions`/`find_fraction_pair` (the existing single-fraction reconstruction) only ever pairs one numerator region with one denominator region — it has no concept of matching *N* numerators to *N* denominators by column.

The fix below sidesteps all four at once by working from the raw `CharBox` geometry of the three rows directly — never relying on `is_maths()`/`Inline` classification for baseline or numerator/denominator detection — and by determining `N` from the one signal that's always reliable here: the connector count on the baseline row.

---

### Task 1: `row_x_extent`, `row_y`, `row_font_size` — row geometry helpers

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (add near `dominant_font_size`, ~line 259)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Produces: `fn row_x_extent(row: &[CharBox]) -> (f32, f32)`, `fn row_y(row: &[CharBox]) -> f32`, `fn row_font_size(row: &[CharBox]) -> f32` — used by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/pdf/layout_tests.rs`, after the existing `groups_characters_sharing_a_baseline_into_one_line` test:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `src-tauri/`): `cargo test --package null-notes row_x_extent_spans_the_widest_printing_characters row_y_and_font_size_read_off_the_row`
Expected: FAIL with "cannot find function `row_x_extent`" (etc.) — the functions don't exist yet.

- [ ] **Step 3: Implement the helpers**

Add to `src-tauri/src/pdf/layout.rs`, directly after `dominant_font_size` (before `pub fn group_lines`):

```rust
/// The horizontal span of a row's printing characters — left edge of the
/// leftmost, right edge of the rightmost. Whitespace carries no width worth
/// counting, so it's excluded the same way `dominant_font_size` excludes it.
fn row_x_extent(row: &[CharBox]) -> (f32, f32) {
    row.iter()
        .filter(|c| !c.ch.is_whitespace())
        .fold((f32::MAX, f32::MIN), |(lo, hi), c| (lo.min(c.x), hi.max(c.x + c.width)))
}

/// A row's own baseline `y` — every character on it shares one by
/// construction (`group_lines`'s baseline-tolerance grouping already
/// guaranteed that), so any one of them reads it off just as well as an
/// average would.
fn row_y(row: &[CharBox]) -> f32 {
    row.iter().map(|c| c.y).fold(f32::MIN, f32::max)
}

/// The row's dominant font size, the same `median`-based measure
/// `build_line` uses for its own `Line::font_size`.
fn row_font_size(row: &[CharBox]) -> f32 {
    let mut sizes: Vec<f32> = row
        .iter()
        .filter(|c| !c.ch.is_whitespace())
        .map(|c| c.font_size)
        .collect();
    median(&mut sizes)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes row_x_extent_spans_the_widest_printing_characters row_y_and_font_size_read_off_the_row`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): add row-level geometry helpers for multi-fraction reconstruction"
```

---

### Task 2: `split_into_terms` — gap-based N-way column splitting

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (add after `row_font_size`)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `horizontal_gap(a: &CharBox, b: &CharBox) -> f32` (existing, ~line 226).
- Produces: `fn split_into_terms(row: &[CharBox], n: usize) -> Option<Vec<Vec<CharBox>>>` — used by Task 4. Returns `None` when the row can't be confidently split into exactly `n` groups.

- [ ] **Step 1: Write the failing tests**

Add to `layout_tests.rs`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package null-notes split_into_terms splits_a_row_into refuses_to_split a_single_term`
Expected: FAIL with "cannot find function `split_into_terms`".

- [ ] **Step 3: Implement `split_into_terms`**

Add to `src-tauri/src/pdf/layout.rs`, after `row_font_size`:

```rust
/// Splits `row`'s printing characters into exactly `n` left-to-right groups,
/// cut at its `n - 1` widest horizontal gaps.
///
/// This is how a numerator or denominator row holding several stacked
/// fraction terms actually divides, once `n` is known from the baseline's
/// own connector count (see `connector_baseline`) — measuring the row's own
/// gaps, rather than guessing from `MATHS_BRIDGE_EMS`, is what correctly
/// separates three denominators that sit closer together than their
/// numerators do.
///
/// `None` when there aren't enough characters to fill `n` non-empty groups,
/// or when the row's gaps don't clearly separate into `n` groups — the
/// narrowest cut chosen must be markedly wider than the widest gap left
/// uncut, or forcing a split would be a guess rather than a measurement.
fn split_into_terms(row: &[CharBox], n: usize) -> Option<Vec<Vec<CharBox>>> {
    let mut sorted: Vec<CharBox> = row.iter().copied().filter(|c| !c.ch.is_whitespace()).collect();
    if sorted.len() < n || n == 0 {
        return None;
    }
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    if n == 1 {
        return Some(vec![sorted]);
    }

    let mut gaps: Vec<(f32, usize)> = sorted
        .windows(2)
        .enumerate()
        .map(|(i, w)| (horizontal_gap(&w[0], &w[1]), i))
        .collect();
    gaps.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    if gaps.len() < n - 1 {
        return None;
    }

    let cuts = &gaps[..n - 1];
    let widest_kept = cuts.iter().map(|(g, _)| *g).fold(f32::INFINITY, f32::min);
    let widest_dropped = gaps.get(n - 1).map(|(g, _)| *g).unwrap_or(0.0);
    if widest_kept <= widest_dropped * 1.5 {
        return None;
    }

    let mut cut_indices: Vec<usize> = cuts.iter().map(|(_, i)| *i).collect();
    cut_indices.sort_unstable();

    let mut groups = Vec::with_capacity(n);
    let mut start = 0;
    for cut in cut_indices {
        groups.push(sorted[start..=cut].to_vec());
        start = cut + 1;
    }
    groups.push(sorted[start..].to_vec());
    Some(groups)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes split_into_terms splits_a_row_into refuses_to_split a_single_term`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): add gap-based N-way row splitting for stacked fraction terms"
```

---

### Task 3: `connector_baseline` and `baseline_label` — recognizing the label/connector row

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (add after `split_into_terms`)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Produces: `fn connector_baseline(row: &[CharBox]) -> Option<(Vec<char>, bool)>` (connectors left-to-right, and whether the row ends in a trailing `.`); `fn baseline_label(row: &[CharBox]) -> String` — both used by Task 4.

- [ ] **Step 1: Write the failing tests**

Add to `layout_tests.rs`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package null-notes connector_baseline a_labelled_row a_baseline_with_no_label a_row_with_only ordinary_prose`
Expected: FAIL with "cannot find function `connector_baseline`" (etc.)

- [ ] **Step 3: Implement `connector_baseline` and `baseline_label`**

Add to `src-tauri/src/pdf/layout.rs`, after `split_into_terms`:

```rust
/// Whether `row` is a "connector baseline": a row whose printing content,
/// once a leading enumeration label like `(b)` is stripped, is nothing but
/// `+`/`-` connectors and an optional trailing `.` — the shape a baseline
/// takes when it joins several side-by-side fraction terms, rather than
/// sitting beside a single one (`f(z) = ... .`) or carrying prose of its
/// own. `None` if the row has any other content, or no connectors at all —
/// zero connectors is a single fraction's baseline, already handled by
/// `reconstruct_fractions`.
///
/// Returns the connectors in left-to-right order and whether the row ends
/// in a trailing period.
fn connector_baseline(row: &[CharBox]) -> Option<(Vec<char>, bool)> {
    let mut sorted: Vec<CharBox> = row.iter().copied().filter(|c| !c.ch.is_whitespace()).collect();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    let after_label = match sorted.iter().position(|c| c.ch == ')') {
        Some(i) => &sorted[i + 1..],
        None => &sorted[..],
    };
    if after_label.is_empty() {
        return None;
    }

    let last = after_label.len() - 1;
    let mut connectors = Vec::new();
    let mut trailing_period = false;
    for (i, c) in after_label.iter().enumerate() {
        match c.ch {
            '+' | '-' | '\u{2212}' => connectors.push(c.ch),
            '.' if i == last => trailing_period = true,
            _ => return None,
        }
    }
    (!connectors.is_empty()).then_some((connectors, trailing_period))
}

/// The leading enumeration label on a connector baseline — `"(b) "` — read
/// straight off the row's own characters (including whatever whitespace
/// follows the `)`) so the reconstructed line keeps the source's own
/// spacing. Empty when the row opens with no such label.
fn baseline_label(row: &[CharBox]) -> String {
    let mut sorted: Vec<CharBox> = row.iter().copied().collect();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    let Some(paren) = sorted.iter().position(|c| c.ch == ')') else {
        return String::new();
    };
    let trailing_space = sorted[paren + 1..].iter().take_while(|c| c.ch.is_whitespace()).count();
    sorted[..=paren + trailing_space].iter().map(|c| c.ch).collect()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes connector_baseline a_labelled_row a_baseline_with_no_label a_row_with_only ordinary_prose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): recognize connector-baseline rows for stacked fraction sums"
```

---

### Task 4: `reconstruct_fraction_sums` — orchestration, wired into `group_lines`

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`:
  - Add `reconstruct_fraction_sums` after `baseline_label`.
  - Modify `group_lines`'s tail (currently `merge_extensible_rows(&mut rows); rows.into_iter().map(build_line).collect()`, ~line 371-372).
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `row_x_extent`, `row_y`, `row_font_size` (Task 1), `split_into_terms` (Task 2), `connector_baseline`, `baseline_label` (Task 3), `latex::to_latex` (existing, `src-tauri/src/pdf/latex.rs`), `range_overlap`, `FRACTION_MAX_ROW_GAP`, `FRACTION_MIN_OVERLAP_RATIO` (existing, ~line 1326-1333 — used as-is; do not move or rename them).
- Produces: `fn reconstruct_fraction_sums(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>)` — first element is the finished `Line`s for every matched fraction sum, second is whatever rows nothing matched, for the caller to run through `build_line` as before.

- [ ] **Step 1: Write the failing integration test**

Add to `layout_tests.rs`. This mirrors the real shape from Analysis_1_Blatt2_2025.pdf exercise 1(b) — `1/x² + y²/(x⁴+x³y) + y³/(x⁵-x³y²)`, three fractions summed with every numerator on one row and every denominator on another — but keeps every term a plain run of same-size, same-baseline characters (no exponents), since exponent detection is `latex::to_latex`'s own concern and already covered by its tests; this test is only about row-splitting and fraction-joining. The denominator row is deliberately laid out with its three terms closer together than the numerator row's own terms — a wider denominator narrows the gap to its neighbor — which is the exact geometry that made the old single-gap-threshold bridging glue all three denominators into one string:

```rust
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
    // than the numerators above them.
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
        markdown.contains(
            "$\\frac{p}{s}$ + $\\frac{q}{t+u}$ + $\\frac{r}{v-w}$."
        ),
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
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `cargo test --package null-notes a_sum_of_three_stacked_fractions_becomes_three_fracs`
Expected: FAIL (assertion failure — the markdown will contain the old garbled output, not the three `\frac{}{}`s). `a_single_fraction_is_left_to_the_existing_reconstruction` should already PASS (it exercises existing, unmodified code) — confirm that too, as a baseline.

- [ ] **Step 3: Implement `reconstruct_fraction_sums` and wire it in**

Add to `src-tauri/src/pdf/layout.rs`, after `baseline_label`:

```rust
/// Finds and reconstructs a "sum of stacked fractions" — several fractions
/// joined by `+`/`-`, with every numerator on one row and every denominator
/// on another, the way exercise 1(b) on Analysis_1_Blatt2_2025.pdf sets
/// `1/x² + y²/(x⁴+x³y) + y³/(x⁵-x³y²)`.
///
/// Runs on the raw rows, before `build_line` collapses them into `Inline`s,
/// because splitting several terms sharing one row needs their real x-gaps:
/// once collapsed to a LaTeX string, a genuine fraction-boundary gap and a
/// gap synthesized around an ordinary internal operator both render as an
/// indistinguishable single space. A single fraction (no connectors) is
/// left alone for `reconstruct_fractions`, further down the pipeline, to
/// keep handling exactly as it does today.
///
/// Consumes rows nearest-baseline-first: every row is examined once as a
/// potential connector baseline, and whichever still-unconsumed numerator
/// and denominator row match it (by vertical gap and horizontal overlap,
/// the same tolerances `find_fraction_pair` uses) are claimed.
///
/// Returns the finished `Line`s for whatever matched, and every row that
/// didn't — for the caller to run through the normal `build_line` path.
fn reconstruct_fraction_sums(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    let plain: Vec<Vec<CharBox>> = rows.iter().map(|r| r.iter().map(|(_, c)| *c).collect()).collect();
    let mut consumed = vec![false; rows.len()];
    let mut synthesized: Vec<Line> = Vec::new();

    for baseline_i in 0..plain.len() {
        if consumed[baseline_i] {
            continue;
        }
        let Some((connectors, trailing_period)) = connector_baseline(&plain[baseline_i]) else {
            continue;
        };
        let terms = connectors.len() + 1;
        let base_y = row_y(&plain[baseline_i]);
        let base_size = row_font_size(&plain[baseline_i]).max(1.0);
        let (base_x0, base_x1) = row_x_extent(&plain[baseline_i]);

        let nearest = |order: Vec<usize>| -> Option<usize> {
            order
                .into_iter()
                .filter(|&i| !consumed[i])
                .filter(|&i| {
                    let gap = (row_y(&plain[i]) - base_y).abs();
                    if gap <= 0.0 || gap > base_size * FRACTION_MAX_ROW_GAP {
                        return false;
                    }
                    let (x0, x1) = row_x_extent(&plain[i]);
                    let overlap = range_overlap(x0, x1, base_x0, base_x1);
                    let min_width = (x1 - x0).min(base_x1 - base_x0).max(1.0);
                    overlap >= min_width * FRACTION_MIN_OVERLAP_RATIO
                })
                .min_by(|&a, &b| {
                    let da = (row_y(&plain[a]) - base_y).abs();
                    let db = (row_y(&plain[b]) - base_y).abs();
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                })
        };

        let Some(num_i) = nearest((0..baseline_i).collect()) else { continue };
        let Some(den_i) = nearest((baseline_i + 1..plain.len()).collect()) else { continue };

        let Some(num_groups) = split_into_terms(&plain[num_i], terms) else { continue };
        let Some(den_groups) = split_into_terms(&plain[den_i], terms) else { continue };

        let fracs: Vec<String> = num_groups
            .iter()
            .zip(den_groups.iter())
            .map(|(n, d)| format!("\\frac{{{}}}{{{}}}", latex::to_latex(n), latex::to_latex(d)))
            .collect();

        let mut content: Vec<Inline> = Vec::new();
        let label = baseline_label(&plain[baseline_i]);
        if !label.is_empty() {
            content.push(Inline::Text(Span { text: label, bold: false, italic: false }));
        }
        for (i, frac) in fracs.iter().enumerate() {
            content.push(Inline::Maths(frac.clone()));
            if let Some(&c) = connectors.get(i) {
                let symbol = if c == '\u{2212}' { '-' } else { c };
                content.push(Inline::Text(Span {
                    text: format!(" {symbol} "),
                    bold: false,
                    italic: false,
                }));
            }
        }
        if trailing_period {
            content.push(Inline::Text(Span { text: ".".to_string(), bold: false, italic: false }));
        }

        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
        });

        let (num_x0, num_x1) = row_x_extent(&plain[num_i]);
        let (den_x0, den_x1) = row_x_extent(&plain[den_i]);

        synthesized.push(Line {
            content,
            x: base_x0.min(num_x0).min(den_x0),
            right: base_x1.max(num_x1).max(den_x1),
            y: base_y,
            font_size: base_size,
            fixed_pitch: false,
            is_display_maths,
            ends_hyphenated: false,
        });

        consumed[baseline_i] = true;
        consumed[num_i] = true;
        consumed[den_i] = true;
    }

    let remaining: Vec<Vec<(usize, CharBox)>> = rows
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !consumed[*i])
        .map(|(_, row)| row)
        .collect();

    (synthesized, remaining)
}
```

Then modify `group_lines`'s tail. Find (near line 371-372):

```rust
    merge_extensible_rows(&mut rows);
    rows.into_iter().map(build_line).collect()
}
```

Replace with:

```rust
    merge_extensible_rows(&mut rows);
    let (mut lines, rows) = reconstruct_fraction_sums(rows);
    lines.extend(rows.into_iter().map(build_line));
    lines.sort_by(|a, b| b.y.partial_cmp(&a.y).unwrap_or(std::cmp::Ordering::Equal));
    lines
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes a_sum_of_three_stacked_fractions_becomes_three_fracs a_single_fraction_is_left_to_the_existing_reconstruction`
Expected: PASS

- [ ] **Step 5: Run the full test suite to check for regressions**

Run (from `src-tauri/`): `cargo test --package null-notes`
Expected: PASS — every existing `pdf::layout`/`pdf::latex` test still passes. If anything regresses, stop and re-examine before continuing; do not paper over a real regression by loosening a guard in `split_into_terms` or `connector_baseline`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): reconstruct sums of stacked fractions sharing one baseline"
```

---

### Task 5: Verify against the real document and check for clippy warnings

**Files:** none (verification only).

- [ ] **Step 1: Run the real-document diagnostic**

From `src-tauri/`:

```bash
NULL_NOTES_PDF=../notes/Analysis_1_Blatt2_2025.pdf cargo test --package null-notes dump_markdown -- --ignored --nocapture
```

Expected: exercise 1(b) now reads `\frac{1}{x^2} + \frac{y^2}{x^4+x^3y} + \frac{y^3}{x^5-x^3y^2}` (or equivalent — exact internal spacing from `latex::to_latex`'s own `SPACE_GAP` synthesis may differ slightly from the hand-built test fixture, that's fine), and exercise 1(c) and 1(d) — the other two three-term sums on this sheet — are similarly readable, each with three distinct `\frac{}{}`s joined by the right `+`/`-`. Exercise 1(c) is minus/minus, 1(d) is minus/plus — confirm both connector signs came through, not just addition.

If any of the three still comes out wrong, do not force a fix by loosening `split_into_terms`'s `1.5` ratio guard or `connector_baseline`'s character set — re-run `dump_line_pieces` (already present in `src-tauri/src/pdf/dump.rs`) against the same `NULL_NOTES_PDF` to see the actual row geometry for whichever exercise is still wrong, and treat it as a new root-cause investigation rather than a tuning knob.

- [ ] **Step 2: Confirm exercise 1(a) (the pre-existing single-fraction case) is unaffected**

Same `dump_markdown` output: exercise 1(a) should still read `\frac{x^3 - 8}{x^2 - 4x + 4}` as it did before this change (the pre-existing separate `$.$` artifact after it is a known, out-of-scope cosmetic issue — do not attempt to fix it here).

- [ ] **Step 3: Run clippy**

From `src-tauri/`: `cargo clippy -- -D warnings`
Expected: clean. Fix anything it flags in the new code before moving on.

- [ ] **Step 4: Commit any clippy fixups, if needed**

```bash
git add src-tauri/src/pdf/layout.rs
git commit -m "fix(pdf): address clippy warnings in fraction-sum reconstruction"
```

(Skip this commit entirely if Step 3 was already clean.)
