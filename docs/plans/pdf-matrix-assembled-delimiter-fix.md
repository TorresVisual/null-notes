# PDF Matrix Assembled-Delimiter Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Reconstruct Analysis_2_Blatt7_2026.pdf's six 3-row column vectors — currently unhandled because their tall `\begin{pmatrix}` bracket is assembled from two stacked glyph pieces (a font artifact, not two logical brackets), and the second piece lands glued directly onto the vector's own prefix/content row rather than on the bracket's own row.

**Architecture:** Two independent, additive generalizations to the existing `reconstruct_matrices` (`layout.rs`): (1) `bracket_glyph` learns the second confirmed codepoint pair, and any `bracket_glyph`-matching character is stripped before a content row renders, wherever it lands; (2) the prefix row search stops assuming a prefix row is *only* prefix — its own characters are also checked for real matrix content inside the bracket's column, and if present, that row contributes a content row too, in addition to its `before`/`after` text.

**Tech Stack:** Rust, `src-tauri/src/pdf/layout.rs` (+ `layout_tests.rs`), `src-tauri/src/pdf/latex.rs` (+ its `#[cfg(test)] mod tests`), no new dependencies.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `pdf/layout.rs` must stay free of any `pdfium` dependency.
- `cargo clippy -- -D warnings` must pass clean before this is done.
- Judge every fix against the real document: `NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt7_2026.pdf cargo test dump_markdown -- --ignored --nocapture`, run from `src-tauri/`.
- Small diffs — this only touches `bracket_glyph` and `reconstruct_matrices`; do not touch `matrix_bracket_row`, `reconstruct_cases`, `reconstruct_fraction_sums`, or `reconstruct_tables`.
- Reuse existing helpers: `row_x_extent`, `row_y`, `row_font_size`, `table_gutters`, `split_row_into_cells`, `cell_has_content`, `row_crosses_gutters`, `latex::to_latex` — unchanged.
- See `docs/specs/pdf-matrix-vector-reconstruction-design.md` §7 for the full design rationale.

---

## Background: what's broken and why

Confirmed by rendering the real PDF (`dump_render_page0`) and reading exact per-character geometry (`dump_chars_range`, `NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt7_2026.pdf NULL_NOTES_PAGE=0 NULL_NOTES_LO=95 NULL_NOTES_HI=126`). Item 1's vector field, `⃗v(x,y,z) = \begin{pmatrix} x+y \\ x+2y² \\ yz \end{pmatrix}`:

```
[97-109]  prefix: "⃗v(x, y, z) ="                                y=625.258
[110]     '\u{f8eb}' open bracket, TOP piece                     x=313.007 y=649.288
[111]     '\u{f8ed}' open bracket, BOTTOM piece (same x)         x=313.007 y=627.769
[112-114] content row 1: "x + y"                                 y=639.804
[115-120] content row 2: "x + 2y^2" — SAME baseline as prefix    y=625.358
[121-122] content row 3: "yz"                                    y=610.912
[123]     '\u{f8f6}' close bracket, TOP piece                    x=361.260 y=649.288
[124]     '\u{f8f8}' close bracket, BOTTOM piece (same x)        x=361.260 y=627.769
```

Visually (confirmed by rendering the page) this is one seamless bracket per side — the font assembles a "medium" pmatrix height from two half-height Private-Use-Area glyph pieces (always the same x, same width, a fixed 21.519pt vertical offset — identical across all six real instances in the document) rather than one precomposed glyph. `group_lines`' baseline-tolerance bucketing puts the two pieces on *different* rows: the top pieces land alone on their own row (the shape `matrix_bracket_row` already detects, once these codepoints are added), but the bottom pieces land glued to the *middle* content row — the same row as the vector's own prefix text and its own `x + 2y²` content. Today's `reconstruct_matrices` has no concept of a row that is simultaneously prefix, content, and a stray delimiter piece — it currently leaves all six vectors unreconstructed.

---

### Task 1: `bracket_glyph` learns the assembled-delimiter codepoints

**Files:**
- Modify: `src-tauri/src/pdf/latex.rs`
- Test: `src-tauri/src/pdf/latex.rs`'s own `#[cfg(test)] mod tests`

**Interfaces:**
- Modifies: `pub(super) fn bracket_glyph(ch: &CharBox) -> Option<bool>` (existing) — adds two more codepoints to each arm. No signature change.

- [ ] **Step 1: Write the failing test**

Add to `latex.rs`'s `mod tests`, directly after `bracket_glyph_identifies_open_and_close_placeholders`:

```rust
#[test]
fn bracket_glyph_identifies_the_assembled_delimiter_pieces() {
    // Analysis_2_Blatt7_2026.pdf item 1: a pmatrix tall enough that its
    // bracket is assembled from two half-height pieces per side, confirmed
    // by rendering the page (dump_render_page0) and reading exact
    // geometry (dump_chars_range) — the top piece ('\u{f8eb}'/'\u{f8f6}')
    // lands alone on its own row, the bottom piece ('\u{f8ed}'/'\u{f8f8}')
    // lands glued to the vector's own prefix/content row. Both pieces of
    // both sides must be recognised, so the bottom piece can be stripped
    // from whatever row it lands on.
    assert_eq!(bracket_glyph(&ch('\u{f8eb}', 313.0, 649.0, 11.96, Family::Extensible)), Some(true));
    assert_eq!(bracket_glyph(&ch('\u{f8ed}', 313.0, 627.0, 11.96, Family::Extensible)), Some(true));
    assert_eq!(bracket_glyph(&ch('\u{f8f6}', 361.0, 649.0, 11.96, Family::Extensible)), Some(false));
    assert_eq!(bracket_glyph(&ch('\u{f8f8}', 361.0, 627.0, 11.96, Family::Extensible)), Some(false));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `src-tauri/`): `cargo test --package null-notes bracket_glyph_identifies_the_assembled_delimiter_pieces`
Expected: FAIL — all four assertions return `None`.

- [ ] **Step 3: Implement**

In `src-tauri/src/pdf/latex.rs`, modify `bracket_glyph`:

```rust
pub(super) fn bracket_glyph(ch: &CharBox) -> Option<bool> {
    if ch.family != Family::Extensible {
        return None;
    }
    match ch.ch {
        '\u{12}' | '\u{10}' | '\0' | '\u{f8eb}' | '\u{f8ed}' => Some(true),
        '\u{13}' | '\u{11}' | '\u{1}' | '\u{f8f6}' | '\u{f8f8}' => Some(false),
        _ => None,
    }
}
```

Also extend `bracket_glyph`'s own existing doc comment (directly above its `fn` line, currently ending "...Same visibility pattern as `is_cases_brace`, for the same reason.") to record the new codepoints and their confirmation. Append a new paragraph immediately after that existing one, still directly above `pub(super) fn bracket_glyph`:

```rust
/// A second confirmed pair, `'\u{f8eb}'`/`'\u{f8f6}'` and
/// `'\u{f8ed}'`/`'\u{f8f8}'`, comes from Analysis_2_Blatt7_2026.pdf: a
/// pmatrix tall enough to need its bracket assembled from two half-height
/// Private-Use-Area glyph pieces per side (confirmed by rendering the page
/// and reading exact geometry — same x, same width, a fixed 21.519pt
/// vertical offset, identical across all six real instances). Both pieces
/// of both sides are mapped, not just one, because `layout.rs`'s
/// `reconstruct_matrices` needs to recognise and strip *either* piece
/// wherever it lands, not only the one that happens to sit on the
/// bracket's own row.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --package null-notes bracket_glyph_identifies_the_assembled_delimiter_pieces`
Expected: PASS

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `cargo test --package null-notes --lib`
Expected: PASS, all of them (this only added new codepoints to existing match arms).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/latex.rs
git commit -m "feat(pdf): recognize the two-piece assembled bracket delimiter"
```

---

### Task 2: `reconstruct_matrices` strips stray bracket pieces and lets a row be both prefix and content

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Modifies: `fn reconstruct_matrices` (existing signature unchanged: `Vec<Vec<(usize, CharBox)>> -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>)`).

- [ ] **Step 1: Write the failing integration test**

Add to `layout_tests.rs`, directly after `a_two_by_two_matrix_becomes_two_pmatrix_columns`:

```rust
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
        real('\u{f8eb}', 313.007, 10.461, 649.288, 11.96, Family::Extensible),
        real('\u{f8ed}', 313.007, 10.461, 627.769, 11.96, Family::Extensible),
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
        real('\u{f8f6}', 361.260, 10.461, 649.288, 11.96, Family::Extensible),
        real('\u{f8f8}', 361.260, 10.461, 627.769, 11.96, Family::Extensible),
    ];

    let markdown = chars_to_markdown(&chars);

    assert!(
        markdown.contains(r"⃗v(x, y, z) = \begin{pmatrix} x + y \\ x + 2y^2 \\ yz \end{pmatrix}"),
        "got: {markdown}"
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --package null-notes an_assembled_delimiter_vector_with_a_fused_prefix_row`
Expected: FAIL — with Task 1 landed, `matrix_bracket_row` now finds the top-piece row as `bracket_i`, but `content_candidates` only ever finds 2 rows (the "x + y" and "yz" rows) since the fused middle row's own full extent (running from the prefix's "⃗v" at x≈252 all the way to "2y^2") fails the existing x-containment check — so the middle row's content never appears, and the bottom bracket piece (`\u{f8ed}`/`\u{f8f8}`) still renders as a literal, un-stripped character glued into whatever row it lands on.

- [ ] **Step 3: Implement**

In `src-tauri/src/pdf/layout.rs`, modify `reconstruct_matrices`. Find the block from the `prefix_i` search through the `row_lines` construction:

```rust
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
                        let mut cell_chars: Vec<CharBox> = cell.into_iter().map(|(_, c)| c).collect();
                        cell_chars.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
                        latex::to_latex(&cell_chars)
                    })
                    .collect::<Vec<_>>()
                    .join(" & "),
                None => {
                    let mut row_chars = plain[ci].clone();
                    row_chars.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
                    latex::to_latex(&row_chars)
                }
            })
            .collect();
```

Replace with:

```rust
        let prefix_i = (0..plain.len()).find(|&i| {
            i != bracket_i
                && !consumed[i]
                && !content_candidates.contains(&i)
                && row_y(&plain[i]) <= top_y
                && row_y(&plain[i]) >= bottom_y
        });

        // A row this pipeline classifies as a bracket glyph is always a
        // delimiter piece, never real matrix content — stripping it before
        // rendering handles a delimiter assembled from more than one glyph
        // (Analysis_2_Blatt7_2026.pdf: a taller pmatrix needs two stacked
        // half-height pieces per side, and the second piece lands wherever
        // its own baseline happens to bucket, not necessarily on the
        // bracket's own row) without needing to model why. For the prefix
        // row specifically, also restrict to the bracket's own column: that
        // row's `before`/`after` text sits outside it by definition, and
        // only characters inside the column are ever this row's own
        // contribution to the matrix's content.
        let inside_of = |row_index: usize| -> Vec<(usize, CharBox)> {
            let restrict_to_column = Some(row_index) == prefix_i;
            rows[row_index]
                .iter()
                .copied()
                .filter(|(_, c)| latex::bracket_glyph(c).is_none())
                .filter(|(_, c)| {
                    !restrict_to_column
                        || (c.x >= open_right - bracket_size * MATRIX_MAX_COLUMN_GAP
                            && c.x <= close_left + bracket_size * MATRIX_MAX_COLUMN_GAP)
                })
                .collect()
        };

        // The prefix row can also carry real matrix content on the same
        // baseline — Analysis_2_Blatt7_2026.pdf's assembled delimiter lands
        // its second piece glued directly to the prefix line, immediately
        // touching that row's own content (`⃗v(x, y, z) = [piece]x + 2y²[piece]`).
        // When that happens, this row is both the prefix *and* one more
        // content row, so it's folded into `content_candidates` at its
        // sorted position rather than only ever contributing text outside
        // the bracket.
        if let Some(pi) = prefix_i {
            if !inside_of(pi).is_empty() {
                content_candidates.push(pi);
                content_candidates.sort_by(|&a, &b| {
                    row_y(&plain[b]).partial_cmp(&row_y(&plain[a])).unwrap_or(std::cmp::Ordering::Equal)
                });
            }
        }

        let content_rows: Vec<Vec<(usize, CharBox)>> =
            content_candidates.iter().map(|&ci| inside_of(ci)).collect();
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
```

Then find the `before_chars`/`after_chars` construction just below it:

```rust
        let (mut before_chars, mut after_chars): (Vec<CharBox>, Vec<CharBox>) = match prefix_i {
            Some(pi) => (
                plain[pi].iter().copied().filter(|c| c.x < open.x).collect(),
                plain[pi].iter().copied().filter(|c| c.x > close.x + close.width).collect(),
            ),
            None => (Vec::new(), Vec::new()),
        };
```

Replace with (also stripping any stray bracket-piece glyph here, for the same reason — defensive, since the real corpus has never shown one landing outside the bracket's own column, but there is no reason to trust that always holds):

```rust
        let (mut before_chars, mut after_chars): (Vec<CharBox>, Vec<CharBox>) = match prefix_i {
            Some(pi) => (
                plain[pi]
                    .iter()
                    .copied()
                    .filter(|c| c.x < open.x && latex::bracket_glyph(c).is_none())
                    .collect(),
                plain[pi]
                    .iter()
                    .copied()
                    .filter(|c| c.x > close.x + close.width && latex::bracket_glyph(c).is_none())
                    .collect(),
            ),
            None => (Vec::new(), Vec::new()),
        };
```

Finally, find the `x`/`right` bounds computation later in the same function:

```rust
        let mut x = open.x;
        let mut right = close.x + close.width;
        for &ci in &content_candidates {
            let (x0, x1) = row_x_extent(&plain[ci]);
            x = x.min(x0);
            right = right.max(x1);
        }
```

Replace with (sourcing from the resolved `content_plain`, which for the fused row is the stripped-and-column-restricted subset rather than the whole row):

```rust
        let mut x = open.x;
        let mut right = close.x + close.width;
        for row in &content_plain {
            let (x0, x1) = row_x_extent(row);
            x = x.min(x0);
            right = right.max(x1);
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --package null-notes an_assembled_delimiter_vector_with_a_fused_prefix_row`
Expected: PASS. If the exact spacing differs from the hand-written expectation, inspect the actual `markdown` value from the test's failure output and adjust the assertion — do not force a match by changing the production logic without first understanding why.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run (from `src-tauri/`): `cargo test --package null-notes --lib`
Expected: PASS — every existing test, including `a_two_row_vector_becomes_one_pmatrix` and `a_two_by_two_matrix_becomes_two_pmatrix_columns` (whose prefix rows have an empty `inside_of` result, so `content_candidates` must come out unchanged for them). If anything regresses, stop and re-examine — do not paper over a real regression by loosening `MATRIX_MAX_COLUMN_GAP`/`MATRIX_MAX_ROW_GAP`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): reconstruct matrices whose bracket is assembled from two glyph pieces"
```

---

### Task 3: Verify against the real document and check for clippy warnings

**Files:** none (verification only), plus `TODO.md`.

- [ ] **Step 1: Run the real-document diagnostic**

From `src-tauri/`:

```bash
NULL_NOTES_PDF=../notes/exercise_sheets/Analysis_2_Blatt7_2026.pdf cargo test --package null-notes dump_markdown -- --ignored --nocapture
```

Expected: all six vector fields (items 1 and 2 on page 0, the Gauß examples in items 3 and 4 on page 0, and the two on page 1) now read as `⃗v(x, y, z) = \begin{pmatrix} ... \end{pmatrix}` (or `...\end{pmatrix}.` where the source has a trailing period), not scattered/glued text.

If any of the six comes out wrong, do not force a fix by loosening a tolerance constant — re-run `dump_chars_range` against that specific instance's coordinates to see the actual row geometry, and treat it as a new root-cause investigation.

- [ ] **Step 2: Spot-check the rest of the document, and the wider corpus, for regressions**

Same `dump_markdown` output: confirm nothing else on this document changed. Then re-run the diagnostic against Analysis_2_Blatt11.pdf and Analysis_2_Blatt5_2026.pdf (the two documents `reconstruct_matrices` was originally verified against) to confirm their vectors still reconstruct exactly as before, and against the remaining real sheets in `notes/exercise_sheets/` to confirm nothing newly misfires.

- [ ] **Step 3: Run clippy**

From `src-tauri/`: `cargo clippy -- -D warnings`
Expected: clean. Fix anything it flags in the new code before moving on.

- [ ] **Step 4: Update `TODO.md`**

Amend the existing "A multi-row vector or matrix scattered across disconnected lines instead of reconstructing" entry (`TODO.md`, P4-2c list) to record this follow-up fix: the assembled two-piece delimiter, the fused prefix/content row, and that Analysis_2_Blatt7_2026.pdf's six vector fields are now confirmed reconstructing — removing the "known and out of scope" note about this document from that entry, matching the style and detail level of the neighbouring entries.

- [ ] **Step 5: Commit any clippy fixups and the `TODO.md` update**

```bash
git add src-tauri/src/pdf/layout.rs TODO.md
git commit -m "docs(pdf): record the assembled-delimiter matrix fix in TODO.md"
```

(Skip the clippy-fixup half of this commit entirely if Step 3 was already clean.)
