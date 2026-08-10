# PDF matrix/vector reconstruction

## Problem

`docs/specs/pdf-table-fraction-maths-guards-design.md` stopped `reconstruct_tables`/`reconstruct_fractions` from *misreading* a multi-row vector or matrix as a table or a bare fraction, but deliberately left positive reconstruction out of scope — a guarded vector still renders as several disconnected `Line`s, not one `\begin{pmatrix}...\end{pmatrix}`. Piecewise (`\cases`) definitions have since been solved the same way cases needed (`reconstruct_cases`, `layout.rs`). Vectors and matrices are the remaining gap CLAUDE.md's PDF-pipeline section still calls out as a structurally different, unsolved problem.

## Real-corpus evidence

Three real documents already carry genuine multi-row vector notation — more than the guards spec's own author had confirmed. All were read via `dump_line_pieces`, the standard diagnostic (`pdf/dump.rs`), not assumed.

**Analysis_2_Blatt11.pdf item 6** — the anchor case, a 2-row column vector:
```
y=757.39  bracket row:   Maths("("), " ", Maths(")")                x=274.4–393.9   (own row, nothing else)
y=747.85  content row 1: Maths("3x^2 - 3y^2 + 2x + 2y")             x=283.2–384.7
y=740.53  prefix row:    Maths("⃗v(x, y) ="), " ", Maths(".")       x=224.9–399.1   ← sits between the two content rows
y=733.41  content row 2: Maths("-6xy + 2x - 2y")                    x=293.4–374.4
```
Bracket glyphs `'\u{12}'`/`'\u{13}'`, already mapped to plain `(`/`)` by `latex::large_paren_glyph`. The prefix row's `y` sits *between* its content rows — the same vertically-centered-label quirk `reconstruct_cases` already solved for `H(t-b) =`.

**Analysis_2_Blatt5_2026.pdf item 3** — same shape, with one variation: the bracket row also carries the sentence's own leading prose ("3. Gegeben ist das Vektorfeld ") before the open bracket, rather than sitting on a row of its own:
```
y=211.34  bracket row:   Text("3. Gegeben ist das Vektorfeld "), Maths("("), " ", Maths(")")
y=197.90  content row 1: Maths("x + y")
y=190.58  prefix row:    Maths("⃗v(x, y) ="), " ", Maths(".")
y=183.46  content row 2: Maths("x - y")
```
Same codepoints as Blatt11. This is the same detection target as `reconstruct_cases`'s own brace row (which already tolerates leading text, e.g. "ist " before its brace) — not a new shape, just confirmation the same tolerance is needed here.

**Analysis_2_Blatt7_2026.pdf** — six 3-row column vectors (`⃗v(x,y,z) = \begin{pmatrix} a \\ b \\ c \end{pmatrix}`), now fully confirmed by rendering the page (`dump_render_page0`) and reading exact per-character geometry (`dump_chars_range`) — not guessed at. Item 1's exact coordinates:

```
[110] '\u{f8eb}' x=313.007 y=649.288  (open, top piece)
[111] '\u{f8ed}' x=313.007 y=627.769  (open, bottom piece — SAME x, 21.519pt below)
...
[123] '\u{f8f6}' x=361.260 y=649.288  (close, top piece)
[124] '\u{f8f8}' x=361.260 y=627.769  (close, bottom piece)
```

Visually this is one seamless `\begin{pmatrix}` bracket per side — the font assembles it from two half-height Private-Use-Area glyph pieces (same x, identical width, a fixed 21.519pt vertical offset — confirmed identical across all six instances) rather than one precomposed glyph, because the 3-row height falls outside whatever single glyph sizes this font subset embeds. `group_lines`' baseline-tolerance row bucketing puts the two pieces on *different* rows: the top pieces (`\u{f8eb}`/`\u{f8f6}`) land alone on their own row — the same shape `matrix_bracket_row` already detects, once these codepoints are added — but the bottom pieces (`\u{f8ed}`/`\u{f8f8}`) land glued directly onto the *middle* content row, immediately touching both the row's own content and its prefix text: `"⃗v(x, y, z) = \u{f8ed}x + 2y² \u{f8f8}"`, all one baseline. That row is simultaneously prefix text, real matrix content, *and* two stray bracket-piece glyphs — a shape neither `matrix_bracket_row` nor the original content/prefix split anticipated. See **Architecture §7** for the fix.

**No genuine multi-column (2+ column) matrix appears anywhere in the current corpus.** The N>1 path can only be verified against generated fixtures (see Testing).

## Architecture

New pass `reconstruct_matrices`, in `pdf/layout.rs`, same tier as `reconstruct_cases` inside `group_lines` — runs on raw rows before `build_line` collapses them, and before `reconstruct_fraction_sums`/`reconstruct_tables` so a matrix's own rows are claimed before a more generic pass gets a chance to misread them (the `TABLE_MATHS_GUARD_RATIO` guard would likely reject them anyway, but claiming explicitly is the same discipline `reconstruct_cases` already established, not a reliance on a backstop).

### 1. Bracket-glyph predicate (`latex.rs`)

`large_paren_glyph` already privately maps every confirmed bracket codepoint to `"("`/`")"`. Add a `pub(super)` wrapper, mirroring `is_cases_brace`:

```rust
pub(super) fn bracket_glyph(ch: &CharBox) -> Option<bool> // Some(true) = open, Some(false) = close
```

so `layout.rs` can identify these glyphs without rendering through them.

### 2. `matrix_bracket_row`

A row is a bracket-pair row if, ignoring whitespace, its printing characters are: optional leading text, then exactly one open-bracket glyph, then exactly one close-bracket glyph, and nothing after — i.e. the close bracket is the row's last printing character. Same shape as `cases_brace_row`, doubled for two glyphs instead of one. Returns `(open: CharBox, close: CharBox, leading: Vec<CharBox>)`.

### 3. Content-row collection

Unconsumed rows (excluding the bracket row) whose x-extent falls inside the bracket's interior span — open's right edge to close's left edge, with the same kind of tolerance `CASES_MAX_COLUMN_GAP` already uses — collected regardless of whether their `y` is above or below the bracket row (Blatt11/Blatt5 both show content straddling it).

### 4. Prefix row

The one remaining unconsumed row whose `y` sits between the topmost and bottommost content row (mirroring `reconstruct_cases`'s vertically-centered-prefix search). Its own characters are split by x into a `before` group (x < open bracket's x) and an `after` group (x > close bracket's right edge) — generalizing `reconstruct_cases`'s prefix, which only ever needed a `before`. Either group may be empty.

### 5. Column detection

Reuses `table_gutters(rows: &[Vec<CharBox>]) -> Option<Vec<f32>>` as-is — it already takes an arbitrary number of rows, already merges character intervals across all of them, and already only accepts a gutter where the gap is consistent across every row given. That cross-row consistency is what keeps a single wide expression's internal operator spacing (`3x² − 3y² + 2x + 2y`) from being mistaken for a column boundary — a gap only counts if it lines up empty in every row.

- `table_gutters` returns `None`/empty → 1 column; each row renders whole via `latex::to_latex`. This is Blatt11 item 6's path.
- Returns `Some(cut_xs)` → split each row via the existing `split_row_into_cells`, render each cell via `latex::to_latex`.

No new column-detection algorithm — this reuses the same helpers `reconstruct_tables` already relies on for exactly this kind of cross-row alignment judgment.

### 6. Assembly

Every confirmed bracket codepoint maps to round parens today, so the emitted environment is always `\begin{pmatrix}...\end{pmatrix}` — columns joined by `&`, rows by `\\`. A `bmatrix`-shaped document is a new codepoint to confirm the same way every other glyph in `latex.rs` was (render, crop, look), not something to guess at now.

```
{before} \begin{pmatrix} r1c1 & r1c2 \\ r2c1 & r2c2 \end{pmatrix} {after}
```

For the anchor case: `⃗v(x, y) = \begin{pmatrix} 3x^2 - 3y^2 + 2x + 2y \\ -6xy + 2x - 2y \end{pmatrix}.`

Empty `before`/`after` degrade cleanly — a bracket row with no surrounding equation just emits the bare `pmatrix`.

### 7. Assembled (multi-piece) delimiters and a fused prefix/content row (Blatt7_2026.pdf)

Two independent generalizations, both needed for this shape:

**Stray bracket-piece glyphs are stripped wherever they land.** A real matrix's content never legitimately contains a bracket placeholder glyph — those only ever exist as delimiters. So before any content row is rendered, `bracket_glyph`-matching characters are filtered out of it first. This handles an assembled delimiter's second piece landing anywhere, without needing to model *why* the font split it into two (or, in principle, more) pieces — no piece-counting, no offset-pattern matching.

**A row can be both prefix and content at once.** Today's prefix row (§4) only ever contributes `before`/`after` text. Once found, its own characters are *also* split into the same `inside` zone content rows use (bracket-glyph-stripped, per above). If that `inside` slice is non-empty, the row contributes a content row too — inserted into the content set at its sorted `y` position, same as any other. Blatt11/Blatt5's prefix rows are unaffected (their `inside` slice is always empty, since their prefix genuinely is a separate row from all content); Blatt7's fused row now correctly yields both its `x + 2y²` content *and* its `⃗v(x, y, z) =`/`.` prefix fragments from the one row.

Internally, this means each content row's actual characters get resolved once — the whole row for an ordinary content row, the filtered `inside` subset for the fused row — into a uniform character list before column-splitting and rendering run, rather than carrying raw row indices through and special-casing at each use site.

## Testing

- **Unit tests** in `layout_tests.rs`, mirroring `reconstruct_cases`'s own test shape: the Blatt11 geometry as a real-coordinate fixture (not the `set()` helper — same reasoning `reconstruct_cases`'s own test documents, gap-ratio splitting needs real gap-width proportions), plus a Blatt5-style bracket-row-with-leading-text variant, plus a synthetic N>1 case to prove `table_gutters` wiring.
- **Real-document regression**: Blatt11 item 6 and Blatt5_2026 item 3 via `dump_markdown`, plus a full sweep of all seven existing real sheets to confirm nothing else shifts (same discipline as every prior P4-2c entry).
- **Blatt7_2026 real-document regression**: all six vector fields (4 on page 0, 2 on page 1) via `dump_markdown`, plus a synthetic unit test for the fused-row shape using item 1's real captured coordinates (§7).
- **N>1 columns**: genuine `pdflatex`-compiled fixtures (MiKTeX, installed for this work), not a mock PDF library — the detection this design adds keys off real CMEX placeholder glyphs that only a real LaTeX engine's maths mode produces; a `reportlab`-style generator (as `notes/tests/table_test.pdf` already is) would never exercise it. A small `.tex` source under a scratch/build location, compiled to PDF and dropped into `notes/tests/` (`matrix_2x2_test.pdf`).

## Out of scope

- **`bmatrix`/other delimiter styles** — no confirmed codepoint in the corpus; add when one appears, same as every other glyph mapping here.
- **Row vectors written inline on one row** (`(a, b, c)` all on one baseline) — already render correctly today via existing per-row maths handling; this pass only exists for content genuinely split across rows.
- **Augmented matrices (`|` divider), nested matrices, or matrices whose bracket row itself spans more than the two glyphs** (e.g. Blatt12's `( ) ( ) ( )` row — confirmed real but not clearly a matrix/vector at all; a separate investigation if it turns out to matter) — not addressed here.
- **A delimiter assembled from three or more pieces**, or a fused row contributing content at more than one point — no confirmed real example needs it; the stray-glyph-stripping approach in §7 would likely extend to it without change, but that's not verified here.
