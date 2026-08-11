# PDF Multi-Bracket Matrix Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Reconstruct Analysis_2_Blatt12.pdf items 4 and 5 — systems of equations that place several independent small matrices/vectors inline in one sentence (`⃗y'(t) = Ay(t) + b(t), mit ⃗y(0) = y₀`) — currently unhandled because `reconstruct_matrices` only recognizes exactly one bracket pair per line.

**Architecture:** Generalize `matrix_bracket_row` and `reconstruct_matrices` in place from "exactly one bracket pair" to "one or more," so N=1 degenerates to exactly today's existing behavior. Content rows are found once and shared across every bracket on the row; each bracket then runs today's single-bracket column-splitting algorithm independently on its own column slice; the prefix generalizes from a `before`/`after` pair to N+1 fragments (before the first bracket, between each adjacent pair, after the last).

**Tech Stack:** Rust, `src-tauri/src/pdf/layout.rs` (+ `layout_tests.rs`), no new dependencies.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `pdf/layout.rs` must stay free of any `pdfium` dependency.
- `cargo clippy -- -D warnings` must pass clean before this is done.
- Judge every fix against the real document: `NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt12.pdf cargo test dump_markdown -- --ignored --nocapture`, run from `src-tauri/`.
- This is a breaking change to `matrix_bracket_row`'s signature (`(open, close, leading)` → `(Vec<(open, close)>, leading)`) — every existing call site and test must be updated, not left on the old shape.
- Every existing real-document case (Analysis_2_Blatt11.pdf, Analysis_2_Blatt5_2026.pdf, Analysis_2_Blatt7_2026.pdf, the pdflatex-compiled 2×2 fixture) is the regression baseline for this change — it must keep reconstructing exactly as it does today, since N=1 is not a separate code path.
- See `docs/specs/pdf-matrix-vector-reconstruction-design.md` §8 for the full design rationale.

---

## Background: what's broken and why

Confirmed by rendering the real PDF (`dump_markdown`) and reading exact per-character geometry (`dump_chars_range`, `NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt12.pdf NULL_NOTES_PAGE=0 NULL_NOTES_LO=1150 NULL_NOTES_HI=1260`). Item 4's system of equations, `⃗y'(t) = Ay(t) + b(t)` with `A=[[1,2],[2,1]]`, `b(t)=[e^{2t},0]ᵀ`, `mit ⃗y(0) = y₀` with `y₀=[1,-1]ᵀ`:

```
bracket row (y=220.271): '\u{12}'@219.397 '\u{13}'@249.866  '\u{12}'@294.546 '\u{13}'@316.562  '\u{12}'@405.157 '\u{13}'@429.108
                          └────── bracket 1 (A) ──────┘      └── bracket 2 (b) ──┘             └──── bracket 3 (y₀) ────┘

content row 1 (y≈210.74): "1"@228.198  "2"@244.003 | "e"@303.346 "2"(super)@308.771 "t"(super)@313.006 | "1"@418.606
content row 2 (y=196.291): "2"@228.198  "1"@244.003 | "0"@307.027                                       | "−"@413.957 "1"@423.255

prefix row (y=203.414): "⃗y'(t) ="@181.260  [bracket1]  "⃗y(t) +"@260.532  [bracket2]  "mit"@339.058  "⃗y(0) ="@368.189  [bracket3]  "."@439.901
```

Three independent bracket pairs share one row, separated only by spaces. The two content rows hold all three matrices'/vectors' values interleaved — bracket 1 (A) gets 2 columns, brackets 2 and 3 (b, y₀) get 1 column each, determined independently. The prefix row's text sits in four segments around the three brackets, not the two (`before`/`after`) today's single-bracket `reconstruct_matrices` knows how to split. Item 5 (`A=[[0,-2],[2,0]]`, `b(t)=[sin(t),0]ᵀ`, `y₀=[0,1]ᵀ`) is the same shape, with the bracket row also carrying leading prose (`"Ordnung: "`) — the same tolerance `matrix_bracket_row` already needed for Analysis_2_Blatt5_2026.pdf item 3.

---

### Task 1: `matrix_bracket_row` generalizes to N bracket pairs

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Modifies: `fn matrix_bracket_row(row: &[CharBox]) -> Option<(Vec<(CharBox, CharBox)>, Vec<CharBox>)>` — was `Option<(CharBox, CharBox, Vec<CharBox>)>`. **Breaking change** — every existing caller and test updates in this task.

- [ ] **Step 1: Update the four existing tests for the new signature**

In `src-tauri/src/pdf/layout_tests.rs`, find and replace each of these four tests (they currently destructure `(open, close, leading)`):

```rust
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
```

```rust
#[test]
fn a_bracket_pair_row_keeps_its_leading_prose() {
    let mut row = set("3. Gegeben ist das Vektorfeld ", 71.00, 211.34, Style::default());
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
```

```rust
#[test]
fn a_row_with_content_between_the_brackets_is_not_a_bracket_pair_row() {
    let mut row = set("\u{12}", 100.0, 700.0, extensible());
    row.extend(set("x + y", 110.0, 700.0, maths_italic()));
    row.extend(set("\u{13}", 160.0, 700.0, extensible()));

    assert_eq!(matrix_bracket_row(&row), None);
}
```

```rust
#[test]
fn a_row_with_only_one_bracket_glyph_is_not_a_bracket_pair_row() {
    let row = set("\u{12}", 100.0, 700.0, extensible());
    assert_eq!(matrix_bracket_row(&row), None);
}
```

(The last two don't destructure a match, so only their assertion's expected type changes implicitly — no visible edit needed beyond confirming they still compile against the new `Option<(Vec<(CharBox, CharBox)>, Vec<CharBox>)>` return type, which `assert_eq!(..., None)` does without modification.)

- [ ] **Step 2: Write two new failing tests for the N>1 case**

Add to `layout_tests.rs`, directly after `a_row_with_only_one_bracket_glyph_is_not_a_bracket_pair_row`:

```rust
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `src-tauri/`): `cargo test --package null-notes bracket_pair_row`
Expected: FAIL — compile errors on the four updated tests (old signature still in production code), and the two new tests fail to compile too.

- [ ] **Step 4: Implement the generalized `matrix_bracket_row`**

In `src-tauri/src/pdf/layout.rs`, replace the current function:

```rust
pub(super) fn matrix_bracket_row(row: &[CharBox]) -> Option<(CharBox, CharBox, Vec<CharBox>)> {
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

with:

```rust
/// Every bracket-glyph pair in `row`, left to right, and every character
/// before the first open bracket — leading prose like "3. Gegeben ist das
/// Vektorfeld " (Analysis_2_Blatt5_2026.pdf item 3) or "Ordnung: "
/// (Analysis_2_Blatt12.pdf item 5), kept in place so a leading phrase
/// stays correctly spaced. `None` unless the row's last printing
/// character is a close bracket and every printing character from the
/// first bracket glyph onward is itself a bracket glyph, strictly
/// alternating open/close/open/close/…, with only whitespace between any
/// two of them — whether within one pair or between two adjacent pairs
/// (Analysis_2_Blatt12.pdf items 4/5: three independent small matrices
/// share one bracket row, separated only by spaces). A single bracket
/// pair is just the `N = 1` case of this same rule.
pub(super) fn matrix_bracket_row(row: &[CharBox]) -> Option<(Vec<(CharBox, CharBox)>, Vec<CharBox>)> {
    let mut sorted: Vec<CharBox> = row.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));

    let bracket_positions: Vec<usize> = sorted
        .iter()
        .enumerate()
        .filter(|(_, c)| latex::bracket_glyph(c).is_some())
        .map(|(i, _)| i)
        .collect();
    if bracket_positions.is_empty() || bracket_positions.len() % 2 != 0 {
        return None;
    }
    let last_printing = sorted.iter().rev().find(|c| !c.ch.is_whitespace())?;
    if latex::bracket_glyph(last_printing) != Some(false) {
        return None;
    }
    for (i, &pos) in bracket_positions.iter().enumerate() {
        if latex::bracket_glyph(&sorted[pos]) != Some(i % 2 == 0) {
            return None;
        }
        if i > 0 {
            let prev_pos = bracket_positions[i - 1];
            if sorted[prev_pos + 1..pos].iter().any(|c| !c.ch.is_whitespace()) {
                return None;
            }
        }
    }

    let first_pos = bracket_positions[0];
    let brackets: Vec<(CharBox, CharBox)> =
        bracket_positions.chunks_exact(2).map(|pair| (sorted[pair[0]], sorted[pair[1]])).collect();
    let leading = sorted[..first_pos].to_vec();
    Some((brackets, leading))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --package null-notes bracket_pair_row`
Expected: Still FAIL — `reconstruct_matrices` still destructures the old 3-tuple shape and won't compile. This is expected; Task 2 fixes it. Confirm the *specific* compile error is in `reconstruct_matrices`'s call site, not in `matrix_bracket_row` itself or the tests just written.

- [ ] **Step 6: Commit**

This task alone won't compile (Task 2 must land in the same commit or immediately after) — combine Steps 4-6 of Task 1 with Task 2's implementation before committing. Skip committing here; continue directly to Task 2.

---

### Task 2: `reconstruct_matrices` loops over N brackets

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `matrix_bracket_row` (Task 1's new signature).
- Modifies: `fn reconstruct_matrices` (signature unchanged: `Vec<Vec<(usize, CharBox)>> -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>)`).

- [ ] **Step 1: Write the failing integration test**

Add to `layout_tests.rs`, directly after `a_two_by_two_matrix_becomes_two_pmatrix_columns` (or any existing `reconstruct_matrices` integration test — exact placement doesn't matter, just keep it grouped with the others):

```rust
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

    assert!(
        markdown.contains(
            r"⃗y'(t) = \begin{pmatrix} 1 & 2 \\ 2 & 1 \end{pmatrix} ⃗y(t) + \begin{pmatrix} e^{2t} \\ 0 \end{pmatrix} mit ⃗y(0) = \begin{pmatrix} 1 \\ -1 \end{pmatrix}."
        ),
        "got: {markdown}"
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --package null-notes a_system_of_equations_with_three_inline_brackets`
Expected: FAIL to compile — `reconstruct_matrices` still destructures `matrix_bracket_row`'s old 3-tuple return.

- [ ] **Step 3: Implement the generalized `reconstruct_matrices`**

In `src-tauri/src/pdf/layout.rs`, replace the entire body of `reconstruct_matrices` (from `let Some((open, close, leading)) = matrix_bracket_row(...)` through the `consumed[bracket_i] = true; ... for &ci in &content_candidates { consumed[ci] = true; }` block, i.e. everything inside the `for bracket_i in 0..plain.len()` loop after the `if consumed[bracket_i] { continue; }` check) with:

```rust
        let Some((brackets, leading)) = matrix_bracket_row(&plain[bracket_i]) else { continue };
        let bracket_size = brackets[0].0.font_size.max(1.0);
        // The overall span from the first bracket's own interior to the
        // last bracket's own interior — content rows are found once and
        // shared across every bracket, then sliced per-bracket below.
        let open_right = brackets[0].0.x + brackets[0].0.width;
        let close_left = brackets[brackets.len() - 1].1.x;
        if open_right >= close_left {
            continue;
        }

        let bracket_y = row_y(&plain[bracket_i]);
        let mut content_candidates: Vec<usize> = (0..plain.len())
            .filter(|&i| i != bracket_i && !consumed[i])
            .filter(|&i| {
                let (x0, x1) = row_x_extent(&plain[i]);
                x0 >= open_right - bracket_size * MATRIX_MAX_COLUMN_GAP
                    && x1 <= close_left + bracket_size * MATRIX_MAX_COLUMN_GAP
            })
            .filter(|&i| (bracket_y - row_y(&plain[i])).abs() <= bracket_size * MATRIX_MAX_ROW_GAP)
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

        // A row's contribution to one bracket's own column: bracket-glyph
        // pieces stripped (a delimiter piece is never real content,
        // wherever it lands — see the `reconstruct_matrices` doc comment
        // for the assembled-delimiter case this handles), and — for the
        // prefix row specifically — restricted to that one bracket's own
        // physical edges, not the wider tolerance used to judge whether
        // an entire other row counts as content (would double-count a
        // fragment of prefix text as both prefix and matrix content).
        let inside_of = |row_index: usize, bracket: &(CharBox, CharBox)| -> Vec<(usize, CharBox)> {
            let restrict_to_column = Some(row_index) == prefix_i;
            rows[row_index]
                .iter()
                .copied()
                .filter(|(_, c)| latex::bracket_glyph(c).is_none())
                .filter(|(_, c)| {
                    !restrict_to_column || (c.x >= bracket.0.x && c.x <= bracket.1.x + bracket.1.width)
                })
                .collect()
        };

        // The prefix row can also carry real matrix content on the same
        // baseline (Analysis_2_Blatt7_2026.pdf's assembled delimiter) —
        // checked against every bracket's own column, since any one of
        // them might be the one whose second piece landed here.
        if let Some(pi) = prefix_i {
            if brackets.iter().any(|b| !inside_of(pi, b).is_empty()) {
                content_candidates.push(pi);
                content_candidates.sort_by(|&a, &b| {
                    row_y(&plain[b]).partial_cmp(&row_y(&plain[a])).unwrap_or(std::cmp::Ordering::Equal)
                });
            }
        }

        // A genuine matrix's own content rows are simple algebraic
        // expressions — every real example in the corpus lacks big
        // operators of its own. Found on Ue9.pdf Beispiel 9.3 (see the
        // single-bracket path this generalizes): an unrelated tall
        // delimiter wrapping a nested formula is geometrically
        // indistinguishable from a real matrix's bracket row.
        if content_candidates.iter().any(|&i| {
            plain[i].iter().any(|c| c.family == Family::Extensible && latex::bracket_glyph(c).is_none())
        }) {
            continue;
        }

        // Each bracket gets its own pmatrix, built from the shared
        // content rows sliced down to that bracket's own column — the
        // same single-bracket column-splitting algorithm as before, run
        // once per bracket, so a 2-column matrix and two 1-column vectors
        // sharing the same rows each get their own independent split.
        let mut pmatrices: Vec<String> = Vec::with_capacity(brackets.len());
        let mut x = brackets[0].0.x;
        let mut right = brackets[brackets.len() - 1].1.x + brackets[brackets.len() - 1].1.width;
        for bracket in &brackets {
            let content_rows: Vec<Vec<(usize, CharBox)>> =
                content_candidates.iter().map(|&ci| inside_of(ci, bracket)).collect();
            let content_plain: Vec<Vec<CharBox>> =
                content_rows.iter().map(|row| row.iter().map(|(_, c)| *c).collect()).collect();
            let cut_xs = table_gutters(&content_plain).filter(|cuts| {
                !cuts.is_empty()
                    && content_plain.iter().all(|row| !row_crosses_gutters(row, cuts))
                    && content_rows.iter().all(|row| {
                        split_row_into_cells(row, cuts).iter().filter(|c| cell_has_content(c)).count()
                            == cuts.len() + 1
                    })
            });

            let row_lines: Vec<String> = content_rows
                .iter()
                .map(|row| match &cut_xs {
                    Some(cuts) => split_row_into_cells(row, cuts)
                        .into_iter()
                        .map(|cell| {
                            let mut cell_chars: Vec<CharBox> = cell.into_iter().map(|(_, c)| c).collect();
                            cell_chars.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
                            latex::to_latex(&cell_chars)
                        })
                        .collect::<Vec<_>>()
                        .join(" & "),
                    None => {
                        let mut row_chars: Vec<CharBox> = row.iter().map(|(_, c)| *c).collect();
                        row_chars.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
                        latex::to_latex(&row_chars)
                    }
                })
                .collect();

            for row in &content_plain {
                let (x0, x1) = row_x_extent(row);
                x = x.min(x0);
                right = right.max(x1);
            }

            pmatrices.push(format!("\\begin{{pmatrix}} {} \\end{{pmatrix}}", row_lines.join(" \\\\ ")));
        }

        // The prefix splits into one fragment more than there are
        // brackets: before the first, between each adjacent pair, and
        // after the last — generalizing the single-bracket before/after
        // split the same way.
        let fragments: Vec<String> = if let Some(pi) = prefix_i {
            // Strict inequalities at both ends, matching exactly what the
            // single-bracket `before`/`after` split used (`c.x < open.x`,
            // `c.x > close.x + close.width`) — `w == 0`/`w == brackets.len()`
            // carry no bound at all on that side, rather than an inclusive
            // one, so this degrades to byte-identical behavior at `N = 1`.
            (0..=brackets.len())
                .map(|w| {
                    let mut fragment_chars: Vec<CharBox> = plain[pi]
                        .iter()
                        .copied()
                        .filter(|c| {
                            let after_prev =
                                w == 0 || c.x > brackets[w - 1].1.x + brackets[w - 1].1.width;
                            let before_next = w == brackets.len() || c.x < brackets[w].0.x;
                            after_prev && before_next && latex::bracket_glyph(c).is_none()
                        })
                        .collect();
                    fragment_chars.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
                    latex::to_latex(&fragment_chars)
                })
                .collect()
        } else {
            vec![String::new(); brackets.len() + 1]
        };

        let mut latex = String::new();
        for (i, pmatrix) in pmatrices.iter().enumerate() {
            let frag = &fragments[i];
            if !frag.is_empty() {
                if i > 0 {
                    latex.push(' ');
                }
                latex.push_str(frag);
                latex.push(' ');
            }
            latex.push_str(pmatrix);
        }
        let last_frag = &fragments[brackets.len()];
        if !last_frag.is_empty() {
            latex.push_str(last_frag);
        }

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
```

- [ ] **Step 4: Run all `matrix_bracket_row`/`reconstruct_matrices` tests to verify they pass**

Run: `cargo test --package null-notes bracket_pair_row pmatrix a_system_of_equations`
Expected: PASS — the four updated Task 1 tests, the two new Task 1 tests, the new integration test, and every pre-existing `reconstruct_matrices` test (`a_two_row_vector_becomes_one_pmatrix`, `a_two_by_two_matrix_becomes_two_pmatrix_columns`, `an_assembled_delimiter_vector_with_a_fused_prefix_row_becomes_one_pmatrix`, `a_content_row_with_a_big_operator_is_not_reconstructed_as_a_matrix`) all still passing unchanged — these are the regression baseline for this generalization.

If the new integration test fails on spacing specifically (not a compile error, not a structural mismatch), inspect the actual `markdown` value and adjust the assertion — do not force a match by changing the production spacing logic without first understanding why it differs.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run (from `src-tauri/`): `cargo test --package null-notes --lib`
Expected: PASS — every existing test. If anything regresses, stop and re-examine before continuing.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): reconstruct systems of equations with multiple inline matrices"
```

---

### Task 3: Verify against the real document and check for clippy warnings

**Files:** none (verification only), plus `TODO.md`.

- [ ] **Step 1: Run the real-document diagnostic**

From `src-tauri/`:

```bash
NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt12.pdf cargo test --package null-notes dump_markdown -- --ignored --nocapture
```

Expected: item 4 reads `⃗y'(t) = \begin{pmatrix} 1 & 2 \\ 2 & 1 \end{pmatrix} ⃗y(t) + \begin{pmatrix} e^{2t} \\ 0 \end{pmatrix} mit ⃗y(0) = \begin{pmatrix} 1 \\ -1 \end{pmatrix}.` (or equivalent — exact internal spacing may differ slightly, that's fine), and item 5 reads `⃗y'(t) = \begin{pmatrix} 0 & -2 \\ 2 & 0 \end{pmatrix} ⃗y(t) + \begin{pmatrix} \sin(t) \\ 0 \end{pmatrix} mit ⃗y(0) = \begin{pmatrix} 0 \\ 1 \end{pmatrix}.` (with `"Ordnung: "` as separate leading text ahead of it, per `matrix_bracket_row`'s `leading` field).

If either comes out wrong, do not force a fix by loosening a tolerance constant — re-run `dump_chars_range` against the specific instance's coordinates to see the actual row geometry, and treat it as a new root-cause investigation.

- [ ] **Step 2: Spot-check the rest of the document, and the wider corpus, for regressions**

Same `dump_markdown` output: confirm the Heaviside `\cases` block (item 3) still reads exactly as before. Then re-run the diagnostic against Analysis_2_Blatt11.pdf, Analysis_2_Blatt5_2026.pdf, Analysis_2_Blatt7_2026.pdf, and Ue9.pdf (the documents this generalization's regression baseline and false-positive guard were verified against) to confirm every one of them still reconstructs exactly as before. Then sweep the remaining real sheets in `notes/exercise_sheets/` to confirm nothing newly misfires.

- [ ] **Step 3: Run clippy**

From `src-tauri/`: `cargo clippy -- -D warnings`
Expected: clean. Fix anything it flags in the new code before moving on.

- [ ] **Step 4: Update `TODO.md`**

Amend the existing "A multi-row vector or matrix scattered across disconnected lines instead of reconstructing" entry (`TODO.md`, P4-2c list) to record this follow-up: `matrix_bracket_row`/`reconstruct_matrices` now handle N independent bracket pairs sharing one row (Analysis_2_Blatt12.pdf items 4/5, systems of equations), generalized in place from the N=1 case rather than as a separate code path — matching the style and detail level of the neighbouring entries.

- [ ] **Step 5: Commit any clippy fixups and the `TODO.md` update**

```bash
git add src-tauri/src/pdf/layout.rs TODO.md
git commit -m "docs(pdf): record multi-bracket matrix reconstruction in TODO.md"
```

(Skip the clippy-fixup half of this commit entirely if Step 3 was already clean.)
