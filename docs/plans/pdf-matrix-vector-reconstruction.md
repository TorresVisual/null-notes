# PDF Matrix/Vector Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Reconstruct a multi-row vector or matrix — a tall bracket pair with N rows (and, in general, M columns) of content between them — into one clean `\begin{pmatrix}...\end{pmatrix}` LaTeX block, instead of the disconnected/glued text the pipeline currently produces for that shape.

**Architecture:** A new geometry-driven reconstruction pass, `reconstruct_matrices`, runs inside `pdf::layout::group_lines` alongside `reconstruct_cases`/`reconstruct_fraction_sums`/`reconstruct_tables` — before `build_line` collapses a row's raw `CharBox`es into `Inline`s, and before the more generic passes get a chance to misread a matrix's own rows. It finds a row holding exactly one open- and one close-bracket placeholder glyph (reusing the codepoints `latex::large_paren_glyph` already maps to plain parens), collects the unconsumed rows whose x-extent falls inside the bracket's interior span as the matrix's content rows, and finds the one remaining unconsumed row whose `y` sits between the content rows as the prefix (split by x into a `before`/`after` pair around the bracket, generalizing `reconstruct_cases`'s brace-relative prefix search). Column count comes from `table_gutters`/`split_row_into_cells` — already-existing helpers `reconstruct_tables` relies on for the same cross-row alignment judgment — not from a new algorithm.

**Tech Stack:** Rust, `src-tauri/src/pdf/layout.rs` (+ `layout_tests.rs`), `src-tauri/src/pdf/latex.rs` (+ its `#[cfg(test)] mod tests`), no new runtime dependencies. MiKTeX (`pdflatex`) is already installed on this machine for generating one genuine multi-column test fixture — a dev-time tool, not a project dependency.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `pdf/layout.rs` must stay free of any `pdfium` dependency — already true of everything this plan builds on (`CharBox`/`Line`/`Inline` logic only).
- `cargo clippy -- -D warnings` must pass clean before this is done.
- Judge every fix against real documents, not synthetic fixtures alone: `NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt11.pdf cargo test dump_markdown -- --ignored --nocapture` (run from `src-tauri/`) is the anchor; `Analysis_2_Blatt5_2026.pdf` is the secondary real-document check.
- Small diffs, no incidental refactors — do not touch `reconstruct_cases`, `reconstruct_fraction_sums`, `reconstruct_tables`, or `latex::large_paren_glyph`'s existing codepoint mappings beyond adding the one new wrapper function this plan needs.
- Reuse existing helpers rather than re-deriving them: `row_x_extent`, `row_y`, `row_font_size`, `table_gutters`, `split_row_into_cells`, `cell_has_content`, `row_crosses_gutters` (all in `layout.rs`, already `pub(super)` or private-but-same-file), and `latex::to_latex`.
- See `docs/specs/pdf-matrix-vector-reconstruction-design.md` for the full design rationale and real-corpus evidence this plan is grounded in.

---

## Background: what's broken and why

Confirmed by rendering the real PDF (`dump_markdown`) that Analysis_2_Blatt11.pdf item 6's real vector field —

```
⃗v(x, y) = ( 3x² − 3y² + 2x + 2y, −6xy + 2x − 2y )
```

— currently extracts as one garbled display-maths block:

```
$
( ) 3x^2 - 3y^2 + 2x + 2y ⃗v(x, y) = . -6xy + 2x - 2y
$
```

Root cause: nothing in the pipeline looks at more than one row at a time for this shape (the same class of gap `reconstruct_cases` already fixed for piecewise definitions). `dump_line_pieces` shows the real row structure:

```
y=757.39  bracket row:   Maths("("), " ", Maths(")")            x=274.4–393.9   (own row, nothing else)
y=747.85  content row 1: Maths("3x^2 - 3y^2 + 2x + 2y")         x=283.2–384.7
y=740.53  prefix row:    Maths("⃗v(x, y) ="), " ", Maths(".")   x=224.9–399.1   ← between the two content rows
y=733.41  content row 2: Maths("-6xy + 2x - 2y")                x=293.4–374.4
```

The prefix row's `y` sits *between* its content rows — the same vertically-centered-label quirk `reconstruct_cases` solved for `H(t-b) =`. A second real document, Analysis_2_Blatt5_2026.pdf item 3, shows the same shape with one variation: the bracket row also carries the sentence's own leading prose ("3. Gegeben ist das Vektorfeld ") ahead of the open bracket, rather than sitting on a row of its own — the same tolerance `reconstruct_cases`'s own brace row already needed (it tolerates leading text like `"ist "` too).

No genuine multi-column (2+ column) matrix exists anywhere in the current document corpus, so that path is verified against a real `pdflatex`-compiled fixture instead (Task 4) — a `reportlab`-style mock PDF library would never produce the CMEX placeholder glyphs this detection keys off of.

---

### Task 1: `latex::bracket_glyph` — open/close bracket identity, shared with `large_paren_glyph`

**Files:**
- Modify: `src-tauri/src/pdf/latex.rs` (add directly after `large_paren_glyph`, ~line 382)
- Test: `src-tauri/src/pdf/latex.rs`'s own `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub(super) fn bracket_glyph(ch: &CharBox) -> Option<bool>` — `Some(true)` for an open bracket, `Some(false)` for a close bracket, `None` otherwise. Used by Task 2 (`layout.rs` cannot see `large_paren_glyph`, which is private to `latex.rs`; same visibility pattern `is_cases_brace` already uses for the same reason).

- [ ] **Step 1: Write the failing test**

Add to `latex.rs`'s `mod tests`, near the other glyph-identity tests (e.g. `the_blatt11_large_paren_placeholders_become_plain_parens`):

```rust
#[test]
fn bracket_glyph_identifies_open_and_close_placeholders() {
    let open = ch('\u{12}', 300.0, 700.0, 11.96, Family::Extensible);
    let close = ch('\u{13}', 300.0, 700.0, 11.96, Family::Extensible);
    assert_eq!(bracket_glyph(&open), Some(true));
    assert_eq!(bracket_glyph(&close), Some(false));

    // The second confirmed codepoint pair (Ue9.pdf's outer nesting level).
    assert_eq!(bracket_glyph(&ch('\u{10}', 300.0, 700.0, 11.96, Family::Extensible)), Some(true));
    assert_eq!(bracket_glyph(&ch('\u{11}', 300.0, 700.0, 11.96, Family::Extensible)), Some(false));

    // The cases-brace glyph is a real Extensible glyph but not a bracket.
    assert_eq!(bracket_glyph(&ch('\u{1a}', 300.0, 700.0, 11.96, Family::Extensible)), None);

    // Same codepoint outside Family::Extensible is not a bracket at all.
    assert_eq!(bracket_glyph(&ch('\u{12}', 300.0, 700.0, 11.96, Family::Text)), None);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `src-tauri/`): `cargo test --package null-notes bracket_glyph_identifies_open_and_close_placeholders`
Expected: FAIL with "cannot find function `bracket_glyph`".

- [ ] **Step 3: Implement `bracket_glyph`**

Add to `src-tauri/src/pdf/latex.rs`, directly after `large_paren_glyph` (~line 382):

```rust
/// Whether `ch` is one of the confirmed large stretchy bracket glyphs
/// `large_paren_glyph` already maps to plain ASCII parens — and if so,
/// whether it is the open or close half of the pair. A dedicated predicate
/// (rather than matching `large_paren_glyph`'s string output) because
/// `layout.rs`'s `reconstruct_matrices` pass needs to identify a row that
/// holds exactly one open and one close bracket glyph — not render them —
/// before any `Line`/`Inline` exists to render into. Same visibility
/// pattern as `is_cases_brace`, for the same reason.
pub(super) fn bracket_glyph(ch: &CharBox) -> Option<bool> {
    if ch.family != Family::Extensible {
        return None;
    }
    match ch.ch {
        '\u{12}' | '\u{10}' | '\0' => Some(true),
        '\u{13}' | '\u{11}' | '\u{1}' => Some(false),
        _ => None,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --package null-notes bracket_glyph_identifies_open_and_close_placeholders`
Expected: PASS

- [ ] **Step 5: Run the existing `large_paren_glyph`-dependent tests to confirm no regression**

Run: `cargo test --package null-notes --lib`
Expected: PASS, all of them (this step only added a sibling function; it did not change what `large_paren_glyph` returns).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/latex.rs
git commit -m "feat(pdf): add a predicate identifying open vs close bracket glyphs"
```

---

### Task 2: `matrix_bracket_row` — a dedicated row predicate, mirroring `cases_brace_row`

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (add directly after `cases_brace_row`, ~line 2108)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `latex::bracket_glyph` (Task 1).
- Produces: `fn matrix_bracket_row(row: &[CharBox]) -> Option<(CharBox, CharBox, Vec<CharBox>)>` — `(open, close, leading)`, used by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `layout_tests.rs`, near the existing `cases_brace_row`-adjacent tests (search for `fn a_labelled_row_of_only_connectors` for the file's existing style, or add fresh near the top of the reconstruction-pass test group):

```rust
// The plain shape (Analysis_2_Blatt11.pdf item 6): a row holding nothing
// but the open and close bracket glyphs, with real whitespace between them
// (the gap the matrix's own content will occupy).
#[test]
fn a_bare_bracket_pair_row_has_no_leading_text() {
    let mut row = set("\u{12}", 274.383, 757.389, extensible());
    row.extend(set(" ", 283.183, 757.389, Style::default()));
    row.extend(set("\u{13}", 385.085, 757.389, extensible()));

    let (open, close, leading) = matrix_bracket_row(&row).expect("expected a bracket-pair row");
    assert_eq!(open.ch, '\u{12}');
    assert_eq!(close.ch, '\u{13}');
    assert!(leading.is_empty());
}

// The Analysis_2_Blatt5_2026.pdf item 3 shape: the bracket row also carries
// the sentence's own leading prose ahead of the open bracket.
#[test]
fn a_bracket_pair_row_keeps_its_leading_prose() {
    let mut row = set("3. Gegeben ist das Vektorfeld ", 71.00, 211.34, Style::default());
    row.extend(set("\u{12}", 320.53, 211.34, extensible()));
    row.extend(set(" ", 329.33, 211.34, Style::default()));
    row.extend(set("\u{13}", 347.32, 211.34, extensible()));

    let (open, close, leading) = matrix_bracket_row(&row).expect("expected a bracket-pair row");
    assert_eq!(open.ch, '\u{12}');
    assert_eq!(close.ch, '\u{13}');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package null-notes a_bare_bracket_pair_row a_bracket_pair_row_keeps a_row_with_content_between a_row_with_only_one_bracket`
Expected: FAIL with "cannot find function `matrix_bracket_row`".

- [ ] **Step 3: Implement `matrix_bracket_row`**

Add to `src-tauri/src/pdf/layout.rs`, directly after `cases_brace_row` (~line 2108):

```rust
/// The open and close bracket-glyph pair in `row`, and every character
/// before the open bracket — leading prose like "3. Gegeben ist das
/// Vektorfeld " (Analysis_2_Blatt5_2026.pdf item 3), kept in place so a
/// leading phrase stays correctly spaced, the same reasoning
/// `cases_brace_row` already documents for its own leading text. `None`
/// unless the row's last printing character is the close bracket and
/// nothing but whitespace sits between the open and close bracket — the
/// row's only real content, besides whatever leads the open bracket, is
/// this one bracket pair.
fn matrix_bracket_row(row: &[CharBox]) -> Option<(CharBox, CharBox, Vec<CharBox>)> {
    let mut sorted: Vec<CharBox> = row.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    if sorted.iter().filter(|c| latex::bracket_glyph(c) == Some(true)).count() != 1
        || sorted.iter().filter(|c| latex::bracket_glyph(c) == Some(false)).count() != 1
    {
        return None;
    }
    let last_printing = sorted.iter().rev().find(|c| !c.ch.is_whitespace())?;
    if latex::bracket_glyph(last_printing) != Some(false) {
        return None;
    }
    let open_pos = sorted.iter().position(|c| latex::bracket_glyph(c) == Some(true))?;
    let close_pos = sorted.iter().position(|c| latex::bracket_glyph(c) == Some(false))?;
    if open_pos >= close_pos || sorted[open_pos + 1..close_pos].iter().any(|c| !c.ch.is_whitespace()) {
        return None;
    }

    let open = sorted[open_pos];
    let close = sorted[close_pos];
    let leading = sorted[..open_pos].to_vec();
    Some((open, close, leading))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes a_bare_bracket_pair_row a_bracket_pair_row_keeps a_row_with_content_between a_row_with_only_one_bracket`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): recognize a matrix/vector's bracket-pair row"
```

---

### Task 3: `reconstruct_matrices` — orchestration, wired into `group_lines`, verified against Analysis_2_Blatt11.pdf

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`:
  - Add one constant near `CASES_MAX_COLUMN_GAP` (~line 2444).
  - Add `reconstruct_matrices` directly after `reconstruct_cases` (~line 2271).
  - Modify `group_lines`'s tail (~line 1061).
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `row_x_extent`, `row_y`, `row_font_size`, `table_gutters`, `split_row_into_cells`, `cell_has_content`, `row_crosses_gutters` (all existing, `layout.rs`), `latex::to_latex` (existing), `matrix_bracket_row` (Task 2).
- Produces: `fn reconstruct_matrices(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>)` — first element the finished `Line`s for every matched matrix/vector, second whatever rows nothing matched, for the caller (and the other reconstruction passes after it) to keep processing.

- [ ] **Step 1: Write the failing integration test**

Add to `layout_tests.rs`. This uses real captured coordinates from `dump_chars_range` on `NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt11.pdf NULL_NOTES_PAGE=1`, the same discipline `reconstruct_cases`'s own integration test follows — a hand-typed `set()` fixture wouldn't reproduce the real gap-width proportions `table_gutters`/column detection depends on:

```rust
// Reconstructs Analysis_2_Blatt11.pdf item 6's real vector field:
// `⃗v(x, y) = (3x² − 3y² + 2x + 2y, −6xy + 2x − 2y).` — a bracket row with
// no leading text, two single-column content rows, and a prefix row
// ("⃗v(x, y) =" ... ".") whose own `y` sits *between* the two content
// rows — TeX centers it vertically against the whole bracket, the same
// quirk `reconstruct_cases` already solved for `H(t-b) =`.
#[test]
fn a_two_row_vector_becomes_one_pmatrix() {
    use real_char as real;

    let mut chars = vec![
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

    assert!(
        markdown.contains(
            r"$⃗v(x, y) = \begin{pmatrix} 3x^2 - 3y^2 + 2x + 2y \\ -6xy + 2x - 2y \end{pmatrix}.$"
        ),
        "got: {markdown}"
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --package null-notes a_two_row_vector_becomes_one_pmatrix`
Expected: FAIL (the rows stay separate/glued — the old, broken output).

- [ ] **Step 3: Implement `reconstruct_matrices` and wire it in**

Add to `src-tauri/src/pdf/layout.rs`, near `CASES_MAX_COLUMN_GAP` (~line 2444):

```rust
// How far a content row's own x-extent may sit outside the bracket's
// interior span (open's right edge to close's left edge) and still count
// as belonging to this matrix — scaled by the bracket's own font size,
// the same reasoning `CASES_MAX_COLUMN_GAP` already documents.
const MATRIX_MAX_COLUMN_GAP: f32 = 2.5;
```

Add directly after `reconstruct_cases` (~line 2271, before `render_content`):

```rust
/// Finds and reconstructs a multi-row vector or matrix: a tall bracket
/// pair with two or more content rows between them, and — as on
/// Analysis_2_Blatt11.pdf item 6 — a prefix row (`⃗v(x, y) =`, `.`) whose
/// own `y` sits *between* the content rows rather than above or below all
/// of them, the same quirk `reconstruct_cases` already solved for
/// `H(t-b) =`.
///
/// Runs on the raw rows, before `build_line` collapses them into
/// `Inline`s, for the same reason `reconstruct_cases` does: column
/// splitting needs each row's own real x-gaps, which a finished `Inline`
/// string no longer distinguishes from an ordinary internal space. Must
/// run before `reconstruct_tables`, or a genuine 2+ column matrix's own
/// rows read exactly like a table.
///
/// Column count comes from `table_gutters` run across every content row
/// together — the same cross-row alignment judgment `reconstruct_tables`
/// already relies on, not a new algorithm. A single wide expression's own
/// internal operator spacing never produces a false column split, because
/// a gutter only counts where *every* content row is simultaneously
/// empty.
///
/// Returns the finished `Line`s for whatever matched, and every row that
/// didn't — for the caller to run through the remaining reconstruction
/// passes and finally `build_line`, unchanged.
fn reconstruct_matrices(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    let plain: Vec<Vec<CharBox>> = rows.iter().map(|r| r.iter().map(|(_, c)| *c).collect()).collect();
    let mut consumed = vec![false; rows.len()];
    let mut synthesized: Vec<Line> = Vec::new();

    for bracket_i in 0..plain.len() {
        if consumed[bracket_i] {
            continue;
        }
        let Some((open, close, leading)) = matrix_bracket_row(&plain[bracket_i]) else { continue };
        let bracket_size = open.font_size.max(1.0);
        let open_right = open.x + open.width;
        let close_left = close.x;
        if open_right >= close_left {
            continue;
        }

        let mut content_candidates: Vec<usize> = (0..plain.len())
            .filter(|&i| i != bracket_i && !consumed[i])
            .filter(|&i| {
                let (x0, x1) = row_x_extent(&plain[i]);
                x0 >= open_right - bracket_size * MATRIX_MAX_COLUMN_GAP
                    && x1 <= close_left + bracket_size * MATRIX_MAX_COLUMN_GAP
            })
            .collect();
        if content_candidates.len() < 2 {
            continue;
        }
        content_candidates.sort_by(|&a, &b| {
            row_y(&plain[b]).partial_cmp(&row_y(&plain[a])).unwrap_or(std::cmp::Ordering::Equal)
        });

        let top_y = row_y(&plain[content_candidates[0]]);
        let bottom_y = row_y(&plain[*content_candidates.last().unwrap_or(&content_candidates[0])]);

        let prefix_i = (0..plain.len()).find(|&i| {
            i != bracket_i
                && !consumed[i]
                && !content_candidates.contains(&i)
                && row_y(&plain[i]) <= top_y
                && row_y(&plain[i]) >= bottom_y
        });

        let content_plain: Vec<Vec<CharBox>> =
            content_candidates.iter().map(|&i| plain[i].clone()).collect();
        let cut_xs = table_gutters(&content_plain).filter(|cuts| {
            !cuts.is_empty()
                && content_candidates.iter().all(|&i| !row_crosses_gutters(&plain[i], cuts))
                && content_candidates.iter().all(|&i| {
                    split_row_into_cells(&rows[i], cuts).iter().filter(|c| cell_has_content(c)).count()
                        == cuts.len() + 1
                })
        });

        let row_lines: Vec<String> = content_candidates
            .iter()
            .map(|&ci| match &cut_xs {
                Some(cuts) => split_row_into_cells(&rows[ci], cuts)
                    .into_iter()
                    .map(|cell| {
                        let cell_chars: Vec<CharBox> = cell.into_iter().map(|(_, c)| c).collect();
                        latex::to_latex(&cell_chars)
                    })
                    .collect::<Vec<_>>()
                    .join(" & "),
                None => latex::to_latex(&plain[ci]),
            })
            .collect();

        let (before_chars, after_chars): (Vec<CharBox>, Vec<CharBox>) = match prefix_i {
            Some(pi) => (
                plain[pi].iter().copied().filter(|c| c.x < open.x).collect(),
                plain[pi].iter().copied().filter(|c| c.x > close.x + close.width).collect(),
            ),
            None => (Vec::new(), Vec::new()),
        };
        let before_latex = latex::to_latex(&before_chars);
        let after_latex = latex::to_latex(&after_chars);

        let mut latex = String::new();
        if !before_latex.is_empty() {
            latex.push_str(&before_latex);
            latex.push(' ');
        }
        latex.push_str("\\begin{pmatrix} ");
        latex.push_str(&row_lines.join(" \\\\ "));
        latex.push_str(" \\end{pmatrix}");
        latex.push_str(&after_latex);

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

        let base_size = prefix_i.map(|pi| row_font_size(&plain[pi])).unwrap_or(bracket_size).max(1.0);
        let mut x = open.x;
        let mut right = close.x + close.width;
        for &ci in &content_candidates {
            let (x0, x1) = row_x_extent(&plain[ci]);
            x = x.min(x0);
            right = right.max(x1);
        }
        if let Some(leading_x0) =
            leading.iter().map(|c| c.x).fold(None, |acc: Option<f32>, v| Some(acc.map_or(v, |a| a.min(v))))
        {
            x = x.min(leading_x0);
        }
        let mut block_top_y = row_y(&plain[bracket_i]).max(top_y);
        if let Some(pi) = prefix_i {
            block_top_y = block_top_y.max(row_y(&plain[pi]));
        }

        synthesized.push(Line {
            content,
            x,
            right,
            y: block_top_y,
            font_size: base_size,
            fixed_pitch: false,
            is_display_maths,
            ends_hyphenated: false,
        });

        consumed[bracket_i] = true;
        if let Some(pi) = prefix_i {
            consumed[pi] = true;
        }
        for &ci in &content_candidates {
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

Then modify `group_lines`'s tail. Find (~line 1061):

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

Replace with:

```rust
    merge_extensible_rows(&mut rows);
    let (mut lines, rows) = reconstruct_cases(rows);
    let (matrix_lines, rows) = reconstruct_matrices(rows);
    lines.extend(matrix_lines);
    let (frac_lines, rows) = reconstruct_fraction_sums(rows);
    lines.extend(frac_lines);
    let (table_lines, rows) = reconstruct_tables(rows);
    lines.extend(table_lines);
    lines.extend(rows.into_iter().map(build_line));
    lines.sort_by(|a, b| b.y.partial_cmp(&a.y).unwrap_or(std::cmp::Ordering::Equal));
    lines
}
```

(`reconstruct_matrices` runs right after `reconstruct_cases` and before `reconstruct_fraction_sums`/`reconstruct_tables`: it needs its bracket, content, and prefix rows still unconsumed and in their original form, and a genuine multi-column matrix's rows would otherwise satisfy `reconstruct_tables`'s own gutter/fill-ratio check.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --package null-notes a_two_row_vector_becomes_one_pmatrix`
Expected: PASS. If the exact spacing differs slightly from the hand-written expectation (e.g. around `\begin{pmatrix}`), inspect the actual `markdown` value from the test's own failure output and adjust the assertion to match real `to_latex` behavior — do not force a match by changing `reconstruct_matrices`' assembly logic itself without first understanding why the spacing differs.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run (from `src-tauri/`): `cargo test --package null-notes --lib`
Expected: PASS — every existing test, including every `reconstruct_cases`/`reconstruct_fraction_sums`/`reconstruct_tables` test. If anything regresses, stop and re-examine before continuing; do not paper over a real regression by loosening `MATRIX_MAX_COLUMN_GAP`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): reconstruct multi-row vectors and matrices into pmatrix blocks"
```

---

### Task 4: Verify the N>1 column path against a genuine `pdflatex`-compiled matrix

**Files:**
- Test: `src-tauri/src/pdf/layout_tests.rs`
- Reference fixture (already generated, gitignored, not part of this commit): `notes/tests/matrix_2x2_test.pdf`, compiled from `.null/scratch/matrix_2x2_test.tex`

**Why this task exists:** no real document in the corpus shows a genuine 2+ column matrix, so this path can only be verified against a real `pdflatex`-compiled PDF (a mock PDF library like `reportlab`, which the existing `notes/tests/table_test.pdf` uses, never produces the CMEX placeholder glyphs `matrix_bracket_row` keys off of). MiKTeX is already installed on this machine.

- [ ] **Step 1: (Reference only — already done) Regenerate the fixture if needed**

The fixture already exists at `notes/tests/matrix_2x2_test.pdf`. To regenerate it from scratch:

```bash
mkdir -p .null/scratch
cat > .null/scratch/matrix_2x2_test.tex <<'EOF'
\documentclass[12pt]{article}
\usepackage{amsmath}
\pagestyle{empty}
\begin{document}
Let $A$ be the matrix
\[
A = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix}.
\]
Compute its determinant.
\end{document}
EOF
cd .null/scratch
"/c/Users/Moritz/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdflatex.exe" -interaction=nonstopmode matrix_2x2_test.tex
cp matrix_2x2_test.pdf ../../notes/tests/matrix_2x2_test.pdf
```

Confirmed via `dump_chars_range` (`NULL_NOTES_PDF=../notes/tests/matrix_2x2_test.pdf NULL_NOTES_PAGE=0 NULL_NOTES_LO=0 NULL_NOTES_HI=200`, run from `src-tauri/`): the bracket glyphs are `'\u{12}'`/`'\u{13}'` — the *same* codepoints already confirmed on Analysis_2_Blatt11.pdf, so no new codepoint mapping is needed for this fixture. The display equation lays out exactly the shape this pass targets: a bracket row (own row, no leading text) at `y=702.562`, two content rows (`a_{11}`/`a_{12}` at `y=693.028`, `a_{21}`/`a_{22}` at `y=678.582`) each holding two columns with a real, consistent ~10.5pt gutter between them, and a prefix row (`A =` before, `.` after) at `y=685.705` — between the two content rows, the same centered-prefix shape as Blatt11.

- [ ] **Step 2: Write the failing test**

Add to `layout_tests.rs`, directly after `a_two_row_vector_becomes_one_pmatrix`:

```rust
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
        markdown.contains(
            r"$A = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix}.$"
        ),
        "got: {markdown}"
    );
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --package null-notes a_two_by_two_matrix_becomes_two_pmatrix_columns`
Expected: FAIL — before Task 3's `reconstruct_matrices` even existed this would fail to compile; after Task 3, without this task's verification it may still fail if `table_gutters`' column split doesn't engage as expected. If it fails at the assertion (not a compile error), inspect the actual `markdown` value: check whether `cut_xs` came back `None` (in which case each row rendered as one ungrouped cell, e.g. `a_{11}a_{12}` glued) or `Some` with the wrong cut points. Re-run `dump_chars_range` on `notes/tests/matrix_2x2_test.pdf` to compare against real geometry rather than adjusting `MATRIX_MAX_COLUMN_GAP` blindly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --package null-notes a_two_by_two_matrix_becomes_two_pmatrix_columns`
Expected: PASS. As in Task 3, adjust the assertion (not the production logic) if `to_latex`'s exact rendering of `a_{11}` differs from what's written here — confirm by printing the actual `markdown` value first.

- [ ] **Step 5: Run the full test suite**

Run: `cargo test --package null-notes --lib`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout_tests.rs
git commit -m "test(pdf): verify multi-column matrix reconstruction against a real pdflatex fixture"
```

(The `.tex` source and compiled `.pdf` live in `.null/scratch/` and `notes/tests/` respectively — both gitignored, matching how the existing `table_test.pdf`/`multi_column_test.pdf` fixtures are handled. Nothing from Step 1 needs to be added to git.)

---

### Task 5: Verify against the real documents and check for clippy warnings

**Files:** none (verification only), plus `TODO.md`.

- [ ] **Step 1: Run the real-document diagnostic on the anchor document**

From `src-tauri/`:

```bash
NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt11.pdf cargo test --package null-notes dump_markdown -- --ignored --nocapture
```

Expected: item 6 now reads as one block, `⃗v(x, y) = \begin{pmatrix} 3x^2 - 3y^2 + 2x + 2y \\ -6xy + 2x - 2y \end{pmatrix}.` (or equivalent — exact internal spacing may differ slightly from the hand-built test fixture, that's fine).

If it comes out wrong, do not force a fix by loosening `MATRIX_MAX_COLUMN_GAP` — re-run `dump_chars_range`/`dump_line_pieces` against the same `NULL_NOTES_PDF` to see the actual row geometry, and treat it as a new root-cause investigation.

- [ ] **Step 2: Run the real-document diagnostic on the secondary document**

```bash
NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt5_2026.pdf cargo test --package null-notes dump_markdown -- --ignored --nocapture
```

Expected: item 3 now reads as one block, `3. Gegeben ist das Vektorfeld $⃗v(x, y) = \begin{pmatrix} x + y \\ x - y \end{pmatrix}.$` (or equivalent) — this is the leading-prose-on-the-bracket-row variant `matrix_bracket_row`'s `leading` field exists for; if it doesn't reconstruct, check whether `leading` came back non-empty as expected (the bracket row here also carries "3. Gegeben ist das Vektorfeld ") before adjusting anything else.

- [ ] **Step 3: Spot-check the rest of both documents, and the wider corpus, for regressions**

Same `dump_markdown` output: confirm nothing *else* on either document changed (the existing fraction/table/cases reconstructions should read exactly as they did before this task). Then run the same diagnostic against the other real PDFs in `notes/exercise_sheets/` to confirm `reconstruct_matrices` never fires where it shouldn't.

**Known, confirmed-real, explicitly not fixed by this plan:** Analysis_2_Blatt7_2026.pdf's six vector fields use a different, unconfirmed codepoint set (`'\u{f8eb}'`/`'\u{f8f6}'` outer, and what looks like a second bracket pair `'\u{f8ed}'`/`'\u{f8f8}'` hugging the middle row) — per the design doc, this needs its own `dump_render_page0`-plus-crop glyph-identity investigation before any codepoint gets added to `bracket_glyph`, the same discipline every other glyph mapping in `latex.rs` already followed. Do not add these codepoints speculatively in this task; if investigated, record it as a follow-up.

- [ ] **Step 4: Run clippy**

From `src-tauri/`: `cargo clippy -- -D warnings`
Expected: clean. Fix anything it flags in the new code before moving on.

- [ ] **Step 5: Update `TODO.md`**

Add a `[x]` entry to the P4-2c list (`TODO.md`, alongside the other Analysis-document-derived fixes) documenting what broke, the geometric root cause (a tall bracket pair with content rows between them, plus a vertically-centered prefix — the same shape class as `reconstruct_cases`), the fix, and the explicit note that Analysis_2_Blatt7_2026.pdf's vector fields remain unfixed pending codepoint confirmation — matching the style of the neighbouring entries (see the existing cases-block entry for the exact tone/detail level expected).

- [ ] **Step 6: Commit any clippy fixups and the `TODO.md` update**

```bash
git add src-tauri/src/pdf/layout.rs TODO.md
git commit -m "docs(pdf): record matrix/vector reconstruction in TODO.md"
```

(Skip the clippy-fixup half of this commit entirely if Step 4 was already clean — just commit the `TODO.md` update.)
