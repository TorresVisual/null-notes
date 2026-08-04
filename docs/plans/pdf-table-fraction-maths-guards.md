# PDF Table/Fraction Maths-Content Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Stop `reconstruct_tables` and `reconstruct_fractions` from misdetecting small aligned maths constructs (`\binom` vectors, `\cases` piecewise definitions, side-by-side binomial-coefficient pairs) as GFM tables or bare fractions.

**Architecture:** Two independent guards added to two existing, purely-geometric detectors in `src-tauri/src/pdf/layout.rs`. `try_table_at` gains a maths-coverage check reusing the existing per-row `maths_runs` seed-and-grow detector; `find_fraction_pair` gains a check for a flanking large-delimiter line, recognizable via the plain `"("`/`")"`/`"\{"` strings `latex::to_latex` now produces for those glyphs (thanks to the already-merged operator-glyphs fix). Both guards are pure rejections — return `None` / `continue` past a candidate — with no new positive reconstruction; rejected content falls through to whatever already happens for content neither pass claims.

**Tech Stack:** Rust, `src-tauri/src/pdf/layout.rs` (+ its test module `layout_tests.rs`). No new files, no new dependencies.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `layout.rs` must stay free of any `pdfium` dependency — everything in this plan is pure `CharBox`/`Line`/`Inline` logic, already true of everything it builds on.
- `cargo clippy -- -D warnings` must pass clean before this is done (run from `src-tauri/`).
- Each task lands as its own commit.
- Neither guard attempts multi-row LaTeX reconstruction (`\begin{pmatrix}`/`\begin{cases}`) — that stays a non-goal per CLAUDE.md. Both guards are purely defensive: stop the false-positive claim, nothing more.
- All commands in this plan assume the working directory is `src-tauri/` (the crate root). `pdf-native` is the default feature, so no `--features` flag is needed for `cargo test`/`cargo build`. Real-document diagnostic runs need `NULL_NOTES_PDF` set to an **absolute path**, since `notes/` is gitignored and the diagnostic's relative-path convention (`../notes/...`) only resolves correctly when running from the actual project checkout, not a worktree — use `D:\Coding\Apps\null-notes\notes\exercise_sheets\<file>.pdf`.
- pdfium's native library (`pdfium.dll`) must be present in `src-tauri/`'s own working directory (or next to the test binary) for any `--ignored` diagnostic run to work — if a fresh worktree reports `pdfium (pdfium.dll) not found`, copy it from `D:\Coding\Apps\null-notes\src-tauri\target\debug\pdfium.dll` into the new worktree's `src-tauri/` before running diagnostics (it's gitignored, so this isn't optional setup the checkout already has).

---

### Task 1: Table guard — reject a maths-heavy candidate window

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `maths_runs(row: &[CharBox], font_size: f32) -> Vec<(usize, usize)>` (existing, already in this file, no changes) and `row_font_size(row: &[CharBox]) -> f32` (existing).
- Produces: `fn maths_coverage_ratio(rows: &[Vec<CharBox>]) -> f32` — a new pure helper. `try_table_at` calls it once, at the point it currently would return `Some(TableMatch { .. })`.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/pdf/layout_tests.rs`, add near the existing table tests (after `two_rows_with_no_shared_gutter_produce_no_table_row_lines`, around line 1202):

```rust
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
        lines.iter().all(|l| !matches!(l.content.as_slice(), [Inline::TableRow(_, _)])),
        "expected no TableRow lines, got {lines:?}"
    );
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test a_maths_heavy_two_by_two_grid_is_not_mistaken_for_a_table -- --nocapture`
Expected: FAIL — today's `try_table_at` has no maths-awareness, so this 2-row, 2-column, fully-filled grid passes every existing check and becomes two `TableRow` lines.

- [ ] **Step 3: Add the constant**

In `src-tauri/src/pdf/layout.rs`, find:

```rust
// ...and at least this fraction of its (row, cell) slots holding real
// content, so a coincidentally-aligned run of mostly-blank lines is never
// mistaken for a data grid.
const TABLE_MIN_FILL_RATIO: f32 = 0.5;
```

Add immediately after it:

```rust
// A candidate table window whose non-whitespace characters are mostly
// covered by maths_runs' own per-row detection is a maths expression that
// happens to have internal alignment gaps (a \binom vector's two rows, a
// \cases block's value/condition columns, side-by-side binomial-coefficient
// pairs) rather than real tabular data. 0.6 comfortably separates the real
// corpus's genuine tables (0% maths-family content: ID/Name/Owner-style
// data) from its maths misfires (close to 100%, since maths_runs' own
// gap-bridging absorbs the surrounding digits/parens too) — see
// docs/specs/pdf-table-fraction-maths-guards-design.md.
const TABLE_MATHS_GUARD_RATIO: f32 = 0.6;
```

- [ ] **Step 4: Add `maths_coverage_ratio`**

In `src-tauri/src/pdf/layout.rs`, immediately above `fn try_table_at` (currently starting around line 681), add:

```rust
/// Fraction of `rows`' non-whitespace characters that fall inside some
/// row's own `maths_runs`-detected span, each row measured independently
/// at its own font size (the same per-row measure `build_line` uses when
/// it actually crops maths regions out of a line). High coverage means a
/// candidate table window is essentially one maths expression rather than
/// real tabular data, even though it satisfies the gutter/fill-ratio
/// checks above — see `TABLE_MATHS_GUARD_RATIO`.
fn maths_coverage_ratio(rows: &[Vec<CharBox>]) -> f32 {
    let mut total = 0usize;
    let mut covered = 0usize;
    for row in rows {
        let printing = row.iter().filter(|c| !c.ch.is_whitespace()).count();
        if printing == 0 {
            continue;
        }
        total += printing;
        let runs = maths_runs(row, row_font_size(row));
        covered += runs
            .iter()
            .map(|&(s, e)| row[s..e].iter().filter(|c| !c.ch.is_whitespace()).count())
            .sum::<usize>();
    }
    if total == 0 {
        0.0
    } else {
        covered as f32 / total as f32
    }
}
```

- [ ] **Step 5: Wire the guard into `try_table_at`**

Find the tail of `try_table_at`:

```rust
    if logical_rows.len() < TABLE_MIN_ROWS {
        return None;
    }
    let total = logical_rows.len() * (cut_xs.len() + 1);
    let filled_count = logical_rows
        .iter()
        .flat_map(|(_, cells)| cells.iter())
        .filter(|c| !c.is_empty())
        .count();
    if (filled_count as f32) < total as f32 * TABLE_MIN_FILL_RATIO {
        return None;
    }

    Some(TableMatch { logical_rows, consumed_rows })
}
```

Replace with:

```rust
    if logical_rows.len() < TABLE_MIN_ROWS {
        return None;
    }
    let total = logical_rows.len() * (cut_xs.len() + 1);
    let filled_count = logical_rows
        .iter()
        .flat_map(|(_, cells)| cells.iter())
        .filter(|c| !c.is_empty())
        .count();
    if (filled_count as f32) < total as f32 * TABLE_MIN_FILL_RATIO {
        return None;
    }
    let consumed_plain: Vec<Vec<CharBox>> =
        consumed_rows.iter().map(|&i| plain[i].clone()).collect();
    if maths_coverage_ratio(&consumed_plain) >= TABLE_MATHS_GUARD_RATIO {
        return None;
    }

    Some(TableMatch { logical_rows, consumed_rows })
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo test a_maths_heavy_two_by_two_grid_is_not_mistaken_for_a_table -- --nocapture`
Expected: PASS.

- [ ] **Step 7: Run the full test suite and clippy**

Run: `cargo test && cargo clippy -- -D warnings`
Expected: all pass, clean — in particular every existing table test (`a_simple_two_column_table_becomes_table_row_lines`, `a_wrapped_cell_merges_into_the_row_above_it_instead_of_a_new_row`, `consecutive_table_row_lines_merge_into_one_table_block`, `a_simple_table_renders_as_gfm`, `a_wrapped_cell_produces_one_clean_data_row`, `two_separate_tables_with_wrapped_rows_stay_separate_and_intact`) must still pass unchanged — all of those use `Style::default()` (`Family::Text`, 0% maths coverage), so `maths_coverage_ratio` reads `0.0` for every one of them and the new guard never fires.

- [ ] **Step 8: Spot-check against a real document**

```bash
NULL_NOTES_PDF="D:\Coding\Apps\null-notes\notes\exercise_sheets\Analysis_2_Blatt12.pdf" cargo test dump_markdown -- --ignored --nocapture
```

Confirm the Heaviside piecewise definition (`H(t-b) = { 1 for t≥b, 0 for t<b`) no longer renders as a `| ist | $\{$ |` table row. If it still does, use `NULL_NOTES_PDF=... NULL_NOTES_NEEDLE="Dabei" cargo test dump_chars_near -- --ignored --nocapture` to inspect the actual character mix in that window and adjust `TABLE_MATHS_GUARD_RATIO` if the real block's maths coverage is lower than 0.6 (some digits/body-font punctuation in the block count toward the non-maths side of the ratio) — record whatever value is actually needed and why, the same empirical-tuning discipline as every other constant in this file.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "fix(pdf): reject a maths-heavy window from table detection"
```

---

### Task 2: Fraction guard — reject a delimiter-flanked pair

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `Line`, `Inline` (existing types, no changes), `FRACTION_MAX_ROW_GAP` (existing constant).
- Produces: `fn is_delimiter_only_line(line: &Line) -> bool` — a new pure helper, called from inside `find_fraction_pair`'s search loop.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/pdf/layout_tests.rs`, add near the existing fraction tests (after `a_baseline_shaped_line_is_never_mistaken_for_the_other_half_of_a_fraction`, around line 926):

```rust
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
    let mut chars = set("(", 290.0, 705.0, extensible());
    chars.extend(set(")", 340.0, 705.0, extensible()));
    chars.extend(set("a + b", 300.0, 700.0, maths_italic()));
    chars.extend(set("c + d", 300.0, 680.0, maths_italic()));

    let markdown = chars_to_markdown(&chars);

    assert!(!markdown.contains(r"\frac{a + b}{c + d}"), "got: {markdown}");
    assert!(markdown.contains("a + b"), "numerator content lost: {markdown}");
    assert!(markdown.contains("c + d"), "denominator content lost: {markdown}");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test a_binom_flanked_pair_of_lines_is_not_mistaken_for_a_bare_fraction -- --nocapture`
Expected: FAIL — today's `find_fraction_pair` has no delimiter awareness, so this pairs exactly like the unflanked case does.

If the test fails with a *different* symptom than `\frac{a + b}{c + d}` appearing (for example, if `"(", ")"` don't survive as separate `"("`/`")"` tokens in the output at all), that means the synthetic `(`/`)` at y=705.0 didn't land on their own `Line` the way the real Blatt11 document's did — run `cargo test a_binom_flanked... -- --nocapture` and read the printed `"got: {markdown}"` to see the actual shape, then adjust the delimiter's `y` (currently `705.0`, `5.0` above the numerator's `700.0` — must stay outside `BASELINE_TOLERANCE` (`0.4`) of `BODY` (`10.0`), i.e. more than `4.0` away, to land on its own line) until the pre-fix markdown does show the wrong `\frac{a + b}{c + d}` with `(`/`)` present elsewhere in the output — confirming the fixture correctly reproduces the bug — before moving to Step 3.

- [ ] **Step 3: Add `is_delimiter_only_line`**

In `src-tauri/src/pdf/layout.rs`, immediately above `fn is_single_region` (currently around line 2062), add:

```rust
/// Whether `line`'s content is nothing but large paren/brace delimiter
/// glyphs (and whitespace between them) — the shape a `\binom`/`\cases`
/// delimiter line takes once `latex::to_latex` has already turned the
/// glyph into a plain `"("`, `")"`, or `"\{"` (see `large_paren_glyph` in
/// `latex.rs`). Evidence that a candidate fraction pair is really a
/// delimiter-flanked multi-row construct, not a bare fraction.
fn is_delimiter_only_line(line: &Line) -> bool {
    if line.content.is_empty() {
        return false;
    }
    line.content.iter().all(|inline| match inline {
        Inline::Maths(latex) => matches!(latex.trim(), "(" | ")" | "\\{"),
        Inline::Text(span) => span.text.trim().is_empty(),
        Inline::TableRow(_, _) | Inline::ImageRef(_, _) => false,
    })
}
```

- [ ] **Step 4: Wire the guard into `find_fraction_pair`**

Find the inner loop body:

```rust
            let overlap = range_overlap(lines[i].x, lines[i].right, lines[j].x, lines[j].right);
            let min_width = (lines[i].right - lines[i].x)
                .min(lines[j].right - lines[j].x)
                .max(1.0);
            if overlap < min_width * FRACTION_MIN_OVERLAP_RATIO {
                continue;
            }
            if best.is_none_or(|(_, _, best_gap)| gap < best_gap) {
                best = Some((i, j, gap));
            }
```

Replace with:

```rust
            let overlap = range_overlap(lines[i].x, lines[i].right, lines[j].x, lines[j].right);
            let min_width = (lines[i].right - lines[i].x)
                .min(lines[j].right - lines[j].x)
                .max(1.0);
            if overlap < min_width * FRACTION_MIN_OVERLAP_RATIO {
                continue;
            }
            let margin = body * FRACTION_MAX_ROW_GAP;
            let flanked = lines
                .iter()
                .any(|l| is_delimiter_only_line(l) && l.y <= lines[i].y + margin && l.y >= lines[j].y - margin);
            if flanked {
                continue;
            }
            if best.is_none_or(|(_, _, best_gap)| gap < best_gap) {
                best = Some((i, j, gap));
            }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test a_binom_flanked_pair_of_lines_is_not_mistaken_for_a_bare_fraction -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Run the full test suite and clippy**

Run: `cargo test && cargo clippy -- -D warnings`
Expected: all pass, clean — in particular `a_numerator_and_denominator_on_separate_lines_become_one_fraction`, `trailing_content_beside_a_fraction_stays_after_it_not_before`, `a_baseline_shaped_line_is_never_mistaken_for_the_other_half_of_a_fraction`, `a_sum_of_three_stacked_fractions_becomes_three_fracs`, and `a_single_fraction_is_left_to_the_existing_reconstruction` must still pass unchanged — none of their fixtures contain a delimiter-only line, so `is_delimiter_only_line` never returns `true` for anything in them and the new guard never fires.

- [ ] **Step 7: Spot-check against a real document**

```bash
NULL_NOTES_PDF="D:\Coding\Apps\null-notes\notes\exercise_sheets\Analysis_2_Blatt7_2026.pdf" cargo test dump_markdown -- --ignored --nocapture
```

Confirm at least one of the six vector fields (item 1's `\vec v(x,y,z) = (x+y, x+2y^2, yz)`, previously `\frac{x + y}{\frac{⃗v(x, y, z) = x + 2y^2}{yz}}`) no longer contains a nested `\frac`. If it's still misdetected, use `NULL_NOTES_PDF=... cargo test dump_lines -- --ignored --nocapture` (one row per reconstructed `Line`, with geometry — this is `group_lines`'s output *before* `reconstruct_fractions` runs, exactly what `find_fraction_pair` sees) to find the delimiter line's actual `y` relative to the two content lines it should flank, and widen `margin` in Step 4 if the real document's delimiter sits further from the content rows than the `FRACTION_MAX_ROW_GAP`-based margin covers — record whatever value is actually needed.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "fix(pdf): reject a delimiter-flanked pair from bare-fraction pairing"
```

---

### Task 3: Real-corpus re-validation

**Files:** none modified — verification only, plus an optional doc update.

**Interfaces:** none — this task consumes the finished behavior of Tasks 1–2 and produces a written confirmation (or a follow-up note) of what's now fixed.

- [ ] **Step 1: Run the full suite one more time from a clean state**

```bash
cd src-tauri
cargo test && cargo clippy -- -D warnings
```

Expected: all pass, clean.

- [ ] **Step 2: Re-run `dump_markdown` against every document the original comparison flagged for bug B or bug D**

For each of: `Ue9.pdf` (Beispiel 9.2's side-by-side binomial coefficients, Beispiel 9.3's inclusion-exclusion sum), `Analysis_2_Blatt7_2026.pdf` (all six vector fields), `Analysis_2_Blatt11.pdf` (items 4, 5, 6), `Analysis_2_Blatt12.pdf` (the Heaviside `\cases` block and items 4/5's matrices), `Analysis_2_Blatt5_2026.pdf` (`\iiint_K` misdetection):

```bash
NULL_NOTES_PDF="D:\Coding\Apps\null-notes\notes\exercise_sheets\<file>.pdf" cargo test dump_markdown -- --ignored --nocapture
```

For each, check whether the bug-B/bug-D symptom recorded for that document (a `|`-table where a maths block should be, or a wrong `\frac{a}{\frac{b}{c}}` nesting) is gone. Symptoms belonging to explicitly out-of-scope bugs (multi-row LaTeX reconstruction, bug C's exponent/subscript placement) are expected to still be present — not a regression, the next spec's job.

- [ ] **Step 3: Record what's still open**

If any bug-B/bug-D symptom persists after Tasks 1–2 (a threshold that needs retuning beyond what Steps 8/7 of Tasks 1–2 already found, or a construct shaped differently enough that neither guard's signal applies), note it plainly — add a short "Implementation notes" section to `docs/specs/pdf-table-fraction-maths-guards-design.md`, the same pattern the operator-glyphs spec's own re-validation notes already established.

- [ ] **Step 4: Commit if Step 3 produced any doc changes**

```bash
git add docs/specs/pdf-table-fraction-maths-guards-design.md
git commit -m "docs(pdf): record real-corpus re-validation results for table/fraction maths guards"
```

(Skip this step entirely if Step 3 found nothing to record.)
