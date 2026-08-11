# PDF Cases-Block Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Reconstruct a piecewise function definition (`H(t-b) = { 1 für t≥b, 0 für t<b`) — a prefix line, a tall opening brace, and N case rows each split into a value and a condition — into one clean `\begin{cases}...\end{cases}` LaTeX block, instead of four disconnected lines of scattered text.

**Architecture:** A new geometry-driven reconstruction pass, `reconstruct_cases`, runs inside `pdf::layout::group_lines` alongside the existing `reconstruct_fraction_sums`/`reconstruct_tables` passes — before `build_line` collapses a row's raw `CharBox`es into `Inline`s, and before `reconstruct_tables` gets a chance to mistake two aligned case-rows for a two-row table. It finds a row holding only the CMEX large-brace placeholder glyph, collects the unconsumed rows below it that share one left-aligned column (the cases), and finds the one remaining unconsumed row whose right edge sits flush against the brace's own left edge (the prefix, typeset vertically centered against the whole block — its row does not sit above or below the cases in `y`, it sits *between* them). A second new helper, `render_condition`, renders a case row's condition half as LaTeX with real prose (`für`) wrapped in `\text{}` — the one place in this reconstruction that needs it, since the existing `latex::to_latex` on its own only recognizes a fixed list of ASCII operator names as upright text, not arbitrary prose.

**Tech Stack:** Rust, `src-tauri/src/pdf/layout.rs` (+ `layout_tests.rs`), `src-tauri/src/pdf/latex.rs` (+ its `#[cfg(test)] mod tests`), no new dependencies.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `pdf/layout.rs` must stay free of any `pdfium` dependency — already true of everything this plan builds on (`CharBox`/`Line`/`Inline` logic only).
- `cargo clippy -- -D warnings` must pass clean before this is done.
- Judge the fix against the real document: `NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt12.pdf cargo test dump_markdown -- --ignored --nocapture`, run from `src-tauri/`. This is the only real document known to carry this shape.
- Small diffs, no incidental refactors — do not touch `reconstruct_fraction_sums`, `reconstruct_tables`, or `maths_runs` beyond adding the new pass alongside them in `group_lines`'s tail.
- Reuse existing helpers rather than re-deriving them: `row_x_extent`, `row_y`, `row_font_size`, `split_into_terms`, `range_overlap` (all in `layout.rs`, already `pub(super)` or private-but-same-file), and `latex::to_latex`.

---

## Background: what's broken and why

Confirmed by rendering the real PDF (`src-tauri/src/pdf/dump.rs`'s `dump_line_pieces`/`dump_chars_range` diagnostics) that Analysis_2_Blatt12.pdf's Heaviside step function definition —

```
Dabei ist H(t-b) = { 1 für t ≥ b
                      0 für t < b .
```

— currently extracts as four disconnected lines:

```
y=364.37  (previous sentence, ends here)      ..., Text(" Dabei")
y=349.92  (brace row)                         Text("ist "), Maths("\{")
y=338.81  (first case)                        Text("1 für "), Maths("t \geq b")
y=331.49  (prefix, vertically centered)       Maths("H(t - b) =")
y=324.37  (second case)                       Text("0 für "), Maths("t < b.")
```

Root cause: nothing in the pipeline ever looks at more than one row at a time for this shape. `maths_runs` correctly recognises the brace glyph (`latex::large_paren_glyph`, confirmed on this document as codepoint `U+001A`, `Family::Extensible`) and renders it as `\{` — but only as a one-glyph maths run tacked onto whatever ordinary text row it happens to share a baseline with (here, "ist ", the word introducing the definition — body-sized like the brace itself, so `group_lines`' own baseline-tolerance grouping puts them on one row same as any other word), with no concept that two rows below it are the brace's own content and one more row (out of `y`-order, sitting *between* the two cases) is the equation it opens.

This is a different shape from the already-handled multi-fraction case (`reconstruct_fraction_sums`): there the connector row's own content (`+`/`-` count) tells the algorithm exactly how many terms to expect. A cases block has no such row — the row count has to come from column alignment instead, and the prefix row's odd vertical position (centered against the whole block, not above or below it) means the code cannot assume "prefix precedes cases in `y`, cases follow it," which every other reconstruction pass in this file has been able to assume so far.

---

### Task 1: `is_cases_brace` — a dedicated predicate, shared with `large_paren_glyph`

**Files:**
- Modify: `src-tauri/src/pdf/latex.rs` (add near `is_sum`, ~line 335; modify `large_paren_glyph`, ~line 359)
- Test: `src-tauri/src/pdf/latex.rs`'s own `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub(super) fn is_cases_brace(ch: &CharBox) -> bool` — used by Task 3 (`layout.rs` cannot see `large_paren_glyph`, which is private to `latex.rs`; this is the same visibility pattern `is_radical`, `is_oint`, `is_integral`, `is_sum` already use for the same reason).

- [ ] **Step 1: Write the failing test**

Add to `latex.rs`'s `mod tests` (near the other `is_*` glyph-identity tests — search for `fn is_oint` usage in tests for the existing style, or add fresh):

```rust
#[test]
fn recognises_the_cases_brace_placeholder_and_nothing_else_at_that_codepoint() {
    let brace = ch('\u{1a}', 300.0, 700.0, 12.0, Family::Extensible);
    assert!(is_cases_brace(&brace));

    // Same codepoint in a non-maths face is not the brace — it is whatever
    // ordinary character U+001A happens to be in that document's body font,
    // the same reasoning every other placeholder-glyph predicate in this
    // file already applies.
    let not_extensible = ch('\u{1a}', 300.0, 700.0, 12.0, Family::Text);
    assert!(!is_cases_brace(&not_extensible));

    let different_glyph = ch('\u{10}', 300.0, 700.0, 12.0, Family::Extensible);
    assert!(!is_cases_brace(&different_glyph));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `src-tauri/`): `cargo test --package null-notes recognises_the_cases_brace_placeholder`
Expected: FAIL with "cannot find function `is_cases_brace`".

- [ ] **Step 3: Implement `is_cases_brace`, and use it from `large_paren_glyph`**

Add to `src-tauri/src/pdf/latex.rs`, directly after `is_sum`:

```rust
/// The large opening brace a `\cases`/piecewise definition needs — see
/// `large_paren_glyph`'s own doc comment for how this codepoint was
/// confirmed on Analysis_2_Blatt12.pdf. A dedicated predicate (rather than
/// matching `large_paren_glyph`'s string output) because `layout.rs`'s new
/// `reconstruct_cases` pass needs to identify this specific glyph — not
/// render it — before any `Line`/`Inline` exists to render into, and
/// `large_paren_glyph` itself is private to this file.
pub(super) fn is_cases_brace(ch: &CharBox) -> bool {
    ch.family == Family::Extensible && ch.ch == '\u{1a}'
}
```

Then change `large_paren_glyph`'s brace arm (currently `'\u{1a}' => Some("\\{"),`) to reuse it — replace the whole `match ch.ch { ... }` body's brace line with a check ahead of the match:

```rust
fn large_paren_glyph(ch: &CharBox) -> Option<&'static str> {
    if ch.family != Family::Extensible {
        return None;
    }
    if is_cases_brace(ch) {
        return Some("\\{");
    }
    match ch.ch {
        '\u{12}' | '\u{10}' | '\0' => Some("("),
        '\u{13}' | '\u{11}' | '\u{1}' => Some(")"),
        _ => None,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --package null-notes recognises_the_cases_brace_placeholder`
Expected: PASS

- [ ] **Step 5: Run the existing `large_paren_glyph`-dependent tests to confirm no regression**

Run: `cargo test --package null-notes --lib`
Expected: PASS, all of them (this step only moved where the `'\u{1a}'` match lives, not what it returns).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/latex.rs
git commit -m "feat(pdf): add a dedicated predicate for the cases-block brace glyph"
```

---

### Task 2: `render_condition` — mixed prose-and-maths rendering for a case's condition half

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (add near `escape_text_for_maths`, ~line 2028)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `CharBox::is_maths()` (existing), `latex::to_latex` (existing), `escape_text_for_maths` (existing, private to `layout.rs`), `SPACE_GAP` (existing constant, `layout.rs`).
- Produces: `fn render_condition(chars: &[CharBox]) -> String` — used by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `layout_tests.rs`, after the existing `split_into_terms`/fraction-sum tests (search for `mod layout_tests` — these go alongside `set`/`maths_italic`/`Style` which are already in scope):

```rust
// "für t ≥ b" — a German connector word followed by a maths comparison, the
// shape a piecewise condition takes. "für" needs \text{} (it is prose, not
// a maths variable a bare `f`, `ü`, `r` triplet would garble into); "t \geq
// b" needs none. The gap between them (a real cursor jump in the source,
// no space glyph) has to become one literal space in the output, not zero
// and not two.
#[test]
fn a_condition_wraps_its_prose_word_but_leaves_the_maths_bare() {
    let mut chars = set("für", 100.0, 700.0, Style::default());
    chars.extend(set("t", 116.0, 700.0, maths_italic()));
    chars.extend(set("\u{2265}", 122.0, 700.0, maths()));
    chars.extend(set("b", 132.0, 700.0, maths_italic()));

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package null-notes a_condition_wraps_its_prose_word a_purely_mathematical_condition`
Expected: FAIL with "cannot find function `render_condition`".

- [ ] **Step 3: Implement `render_condition`**

Add to `src-tauri/src/pdf/layout.rs`, directly after `escape_text_for_maths`:

```rust
/// Renders a case row's condition half ("für t ≥ b") as LaTeX: each maximal
/// run of non-maths-family characters is real prose and gets `\text{}`
/// wrapped (`to_latex` on its own only recognises a fixed, ASCII-only list
/// of operator names as upright text — a German connector word like "für"
/// falls through that and would otherwise render as bare, implicitly
/// italicised maths variables), each maths-family run renders through
/// `to_latex` exactly as it already does anywhere else in this pipeline.
///
/// A literal space is inserted between two consecutive pieces only when the
/// source's own horizontal gap between them is wide enough to have been a
/// real word-space (mirrors `SPACE_GAP`, the same threshold `build_line`
/// and `latex::to_latex` already use) — never unconditionally, which would
/// insert spaces a tightly-kerned run never had.
fn render_condition(chars: &[CharBox]) -> String {
    let em = chars.iter().map(|c| c.font_size).fold(0.0_f32, f32::max).max(1.0);
    let mut out = String::new();
    let mut previous_end: Option<f32> = None;
    let mut index = 0;

    while index < chars.len() {
        let is_maths = chars[index].is_maths();
        let start = index;
        while index < chars.len() && chars[index].is_maths() == is_maths {
            index += 1;
        }
        let run = &chars[start..index];

        let piece = if is_maths {
            let latex = latex::to_latex(run);
            (!latex.is_empty()).then_some(latex)
        } else {
            let text: String = run.iter().map(|c| c.ch).collect();
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| format!("\\text{{{}}}", escape_text_for_maths(trimmed)))
        };

        let Some(piece) = piece else { continue };

        let run_start = run.iter().map(|c| c.x).fold(f32::MAX, f32::min);
        if let Some(end) = previous_end {
            if run_start - end > em * SPACE_GAP && !out.ends_with(' ') {
                out.push(' ');
            }
        }
        out.push_str(&piece);
        previous_end = Some(run.iter().map(|c| c.x + c.width).fold(f32::MIN, f32::max));
    }

    out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes a_condition_wraps_its_prose_word a_purely_mathematical_condition`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): render a cases-block condition's prose and maths correctly mixed"
```

---

### Task 3: `reconstruct_cases` — orchestration, wired into `group_lines`

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`:
  - Add two constants near `FRACTION_MAX_ROW_GAP`/`FRACTION_MIN_OVERLAP_RATIO` (~line 2194).
  - Add `reconstruct_cases` after `render_condition`.
  - Modify `group_lines`'s tail (currently `merge_extensible_rows(&mut rows); let (mut lines, rows) = reconstruct_fraction_sums(rows); ...`, ~line 1061).
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `row_x_extent`, `row_y`, `row_font_size`, `split_into_terms` (all existing, Task 2's this-plan-independent siblings), `render_condition` (Task 2), `latex::to_latex`, `latex::is_cases_brace` (Task 1).
- Produces: `fn reconstruct_cases(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>)` — first element the finished `Line`s for every matched cases block, second whatever rows nothing matched, for the caller (and the other reconstruction passes after it) to keep processing.

- [ ] **Step 1: Write the failing integration test**

Add to `layout_tests.rs`. This mirrors the real shape from Analysis_2_Blatt12.pdf's Heaviside step function — a prefix, a brace, and two cases, with the prefix's row sitting vertically *between* the two case rows, exactly as the real document lays it out — using real captured coordinates (`dump_chars_range` on `NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt12.pdf`):

```rust
// Reconstructs Analysis_2_Blatt12.pdf's Heaviside step function definition:
// a leading word ("ist ") sharing the brace glyph's own row, a prefix
// ("H(t-b) ="), and two cases each split into a value and a "für
// <condition>" half. The prefix row's own y (331.49) sits *between* the two
// case rows (338.81 and 324.37) — TeX centers "H(t-b) =" vertically against
// the whole two-line cases block — which is exactly the shape that broke
// every reconstruction pass that assumed a prefix always precedes its
// content in `y`.
#[test]
fn a_heaviside_style_cases_block_becomes_one_display_equation() {
    // Real per-character geometry throughout (`dump_chars_range` on
    // Analysis_2_Blatt12.pdf), not the file's `set()` helper: `set()` gives
    // every glyph in one call the same synthetic width (`size * ADVANCE`),
    // but `split_into_terms`'s value/condition split depends on the
    // *real* gap-width ratios between "1"/"0" and "für" being clearly
    // wider than any gap inside "für t ≥ b" itself — an artificial uniform
    // width doesn't reproduce that margin, and the split would fail for a
    // reason that has nothing to do with `reconstruct_cases` itself.
    fn real(c: char, x: f32, w: f32, y: f32, size: f32, family: Family) -> CharBox {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --package null-notes a_heaviside_style_cases_block_becomes_one_display_equation`
Expected: FAIL (the four rows stay separate — the old, broken output).

- [ ] **Step 3: Implement `reconstruct_cases` and wire it in**

Add to `src-tauri/src/pdf/layout.rs`, near `FRACTION_MAX_ROW_GAP`:

```rust
// How far a case row's own left edge, or a prefix row's own right edge, may
// sit from the brace's edge and still count as "that row belongs to this
// brace" — scaled by the brace's own font size the same way
// FRACTION_MAX_ROW_GAP scales by a fraction's own body size.
const CASES_MAX_COLUMN_GAP: f32 = 2.5;
// How far a case row's left edge may drift from the first case row's own
// left edge and still count as the same left-aligned column.
const CASES_COLUMN_TOLERANCE: f32 = 1.0;
```

Add after `render_condition`:

```rust
/// The single cases-brace glyph in `row`, and every character before it —
/// the "ist " that shares its row, whitespace kept in place so a
/// multi-word leading phrase stays correctly spaced — as long as the brace
/// is the last *printing* character on the row (never followed by
/// anything but trailing whitespace, which is the only shape a real
/// `\cases` block's opening brace takes). `None` when the row has no
/// brace, more than one, or real content after it — any of those means
/// this row is not a plausible cases-brace row at all.
fn cases_brace_row(row: &[CharBox]) -> Option<(CharBox, Vec<CharBox>)> {
    let mut sorted: Vec<CharBox> = row.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    if sorted.iter().filter(|c| latex::is_cases_brace(c)).count() != 1 {
        return None;
    }
    let last_printing = sorted.iter().rev().find(|c| !c.ch.is_whitespace())?;
    if !latex::is_cases_brace(last_printing) {
        return None;
    }
    let brace_pos = sorted.iter().position(|c| latex::is_cases_brace(c))?;
    let brace = sorted[brace_pos];
    sorted.truncate(brace_pos);
    Some((brace, sorted))
}

/// Finds and reconstructs a piecewise ("cases") function definition: a
/// prefix ("H(t-b) ="), a tall opening brace, and two or more case rows
/// beneath it, each splitting into a value and a condition — the shape
/// Analysis_2_Blatt12.pdf's Heaviside step function definition sets.
///
/// Runs on the raw rows, before `build_line` collapses them into `Inline`s,
/// for the same reason `reconstruct_fraction_sums` does: splitting a case
/// row into its value and condition needs the row's own real x-gap, which a
/// finished `Inline` string no longer distinguishes from an ordinary
/// internal space. It also has to run *before* `reconstruct_tables`, or two
/// left-aligned case rows read exactly like a two-row table.
///
/// The prefix row cannot be found by `y`-order the way every other row in
/// this file is processed: TeX sets it vertically centered against the
/// whole cases block, so it sits *between* the case rows in `y`, not above
/// or below them. It is identified purely by `x` instead — the one
/// unconsumed row whose right edge sits flush against the brace's own left
/// edge.
///
/// Returns the finished `Line`s for whatever matched, and every row that
/// didn't — for the caller to run through the remaining reconstruction
/// passes and finally `build_line`, unchanged.
fn reconstruct_cases(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    let plain: Vec<Vec<CharBox>> = rows.iter().map(|r| r.iter().map(|(_, c)| *c).collect()).collect();
    let mut consumed = vec![false; rows.len()];
    let mut synthesized: Vec<Line> = Vec::new();

    for brace_i in 0..plain.len() {
        if consumed[brace_i] {
            continue;
        }
        let Some((brace, leading)) = cases_brace_row(&plain[brace_i]) else { continue };
        let brace_size = brace.font_size.max(1.0);
        let brace_left = brace.x;
        let brace_right = brace.x + brace.width;

        let mut case_candidates: Vec<usize> = (0..plain.len())
            .filter(|&i| i != brace_i && !consumed[i])
            .filter(|&i| row_y(&plain[i]) < brace.y)
            .filter(|&i| (row_x_extent(&plain[i]).0 - brace_right).abs() <= brace_size * CASES_MAX_COLUMN_GAP)
            .collect();
        if case_candidates.len() < 2 {
            continue;
        }
        case_candidates.sort_by(|&a, &b| row_y(&plain[b]).partial_cmp(&row_y(&plain[a])).unwrap_or(std::cmp::Ordering::Equal));

        let column_x = row_x_extent(&plain[case_candidates[0]]).0;
        let aligned = case_candidates
            .iter()
            .all(|&i| (row_x_extent(&plain[i]).0 - column_x).abs() <= brace_size * CASES_COLUMN_TOLERANCE);
        if !aligned {
            continue;
        }

        let top_y = row_y(&plain[case_candidates[0]]);
        let bottom_y = row_y(&plain[*case_candidates.last().unwrap_or(&case_candidates[0])]);
        let prefix_i = (0..plain.len()).find(|&i| {
            i != brace_i
                && !consumed[i]
                && !case_candidates.contains(&i)
                && (row_x_extent(&plain[i]).1 - brace_left).abs() <= brace_size * CASES_MAX_COLUMN_GAP
                && row_y(&plain[i]) <= top_y
                && row_y(&plain[i]) >= bottom_y
        });
        let Some(prefix_i) = prefix_i else { continue };

        let mut case_lines: Vec<String> = Vec::with_capacity(case_candidates.len());
        let mut split_failed = false;
        for &ci in &case_candidates {
            let Some(parts) = split_into_terms(&plain[ci], 2) else {
                split_failed = true;
                break;
            };
            let value = latex::to_latex(&parts[0]);
            let condition = render_condition(&parts[1]);
            case_lines.push(format!("{value} & {condition}"));
        }
        if split_failed {
            continue;
        }

        let prefix_latex = latex::to_latex(&plain[prefix_i]);
        let latex = format!(
            "{prefix_latex} \\begin{{cases}} {} \\end{{cases}}",
            case_lines.join(" \\\\ ")
        );

        let base_size = row_font_size(&plain[prefix_i]).max(1.0);
        let mut x = row_x_extent(&plain[prefix_i]).0.min(brace_left);
        let mut right = brace_right;
        for &ci in &case_candidates {
            let (x0, x1) = row_x_extent(&plain[ci]);
            x = x.min(x0);
            right = right.max(x1);
        }
        if let Some(leading_x0) = leading.iter().map(|c| c.x).fold(None, |acc: Option<f32>, v| {
            Some(acc.map_or(v, |a| a.min(v)))
        }) {
            x = x.min(leading_x0);
        }

        // The word(s) introducing the definition ("ist ") stay as ordinary
        // text ahead of the equation, the same way `reconstruct_fraction_sums`
        // keeps a baseline's own enumeration label ahead of its fractions —
        // it is prose, not part of the LaTeX. The trailing space is
        // synthesized rather than read off `leading`'s own characters, the
        // same reasoning `baseline_label` already documents: a PDF often
        // places the next glyph via a bare cursor jump, no space character
        // at all, between a word and what follows it.
        let mut content: Vec<Inline> = Vec::new();
        let leading_text: String = leading.iter().map(|c| c.ch).collect();
        let leading_trimmed = leading_text.trim();
        if !leading_trimmed.is_empty() {
            content.push(Inline::Text(Span {
                text: format!("{leading_trimmed} "),
                bold: false,
                italic: false,
            }));
        }
        content.push(Inline::Maths(latex));
        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_, _) | Inline::ImageRef(_, _) => false,
        });

        synthesized.push(Line {
            content,
            x,
            right,
            y: top_y,
            font_size: base_size,
            fixed_pitch: false,
            is_display_maths,
            ends_hyphenated: false,
        });

        consumed[brace_i] = true;
        consumed[prefix_i] = true;
        for &ci in &case_candidates {
            consumed[ci] = true;
        }
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

Then modify `group_lines`'s tail. Find (near line 1061-1066):

```rust
    merge_extensible_rows(&mut rows);
    let (mut lines, rows) = reconstruct_fraction_sums(rows);
    let (table_lines, rows) = reconstruct_tables(rows);
    lines.extend(table_lines);
    lines.extend(rows.into_iter().map(build_line));
    lines.sort_by(|a, b| b.y.partial_cmp(&a.y).unwrap_or(std::cmp::Ordering::Equal));
    lines
}
```

Replace with:

```rust
    merge_extensible_rows(&mut rows);
    let (mut lines, rows) = reconstruct_cases(rows);
    let (frac_lines, rows) = reconstruct_fraction_sums(rows);
    lines.extend(frac_lines);
    let (table_lines, rows) = reconstruct_tables(rows);
    lines.extend(table_lines);
    lines.extend(rows.into_iter().map(build_line));
    lines.sort_by(|a, b| b.y.partial_cmp(&a.y).unwrap_or(std::cmp::Ordering::Equal));
    lines
}
```

(`reconstruct_cases` runs first: it needs the two case rows and the prefix row still unconsumed and in their original, un-reordered form, and — since two aligned case rows would otherwise satisfy `reconstruct_tables`'s own column-gutter check — it has to claim them before that pass gets a chance to.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes a_heaviside_style_cases_block_becomes_one_display_equation`
Expected: PASS

- [ ] **Step 5: Run the full test suite to check for regressions**

Run (from `src-tauri/`): `cargo test --package null-notes --lib`
Expected: PASS — every existing test, including every `reconstruct_fraction_sums`/`reconstruct_tables` test. If anything regresses, stop and re-examine before continuing; do not paper over a real regression by loosening `CASES_MAX_COLUMN_GAP`/`CASES_COLUMN_TOLERANCE`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): reconstruct piecewise cases-block definitions"
```

---

### Task 4: Verify against the real document and check for clippy warnings

**Files:** none (verification only), plus `TODO.md`.

- [ ] **Step 1: Run the real-document diagnostic**

From `src-tauri/`:

```bash
NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt12.pdf cargo test --package null-notes dump_markdown -- --ignored --nocapture
```

Expected: the Heaviside definition now reads as one block, `H(t-b) = \begin{cases} 1 & \text{für} t \geq b \\ 0 & \text{für} t < b. \end{cases}` (or equivalent — exact internal spacing from `render_condition`'s own gap synthesis may differ slightly from the hand-built test fixture, that's fine).

If it comes out wrong, do not force a fix by loosening `CASES_MAX_COLUMN_GAP`/`CASES_COLUMN_TOLERANCE` or the `case_candidates.len() < 2` floor — re-run `dump_chars_range`/`dump_line_pieces` against the same `NULL_NOTES_PDF` to see the actual row geometry, and treat it as a new root-cause investigation.

- [ ] **Step 2: Spot-check the rest of the document and the wider corpus for regressions**

Same `dump_markdown` output: confirm nothing *else* on this document changed (the fraction-sum reconstruction, the compact-fraction numerator-with-nested-exponent fix, the ligature/quote recovery — all already-verified — should read exactly as they did before this task). Then run the same diagnostic against at least one other real PDF in `notes/exercise_sheets/` (e.g. `Analysis_2_Blatt11.pdf`) to confirm `reconstruct_cases` never fires where it shouldn't — it should find zero cases blocks there and change nothing.

- [ ] **Step 3: Run clippy**

From `src-tauri/`: `cargo clippy -- -D warnings`
Expected: clean. Fix anything it flags in the new code before moving on.

- [ ] **Step 4: Update `TODO.md`**

Add a `[x]` entry to the P4-2c list (`TODO.md`, alongside the other Analysis_2_Blatt12.pdf-derived fixes) documenting what broke, the geometric root cause (the prefix row's vertically-centered position relative to the cases, not above or below them), and the fix — matching the style of the neighbouring entries.

- [ ] **Step 5: Commit any clippy fixups and the `TODO.md` update**

```bash
git add src-tauri/src/pdf/layout.rs TODO.md
git commit -m "docs(pdf): record cases-block reconstruction in TODO.md"
```

(Skip the clippy-fixup half of this commit entirely if Step 3 was already clean — just commit the `TODO.md` update.)
