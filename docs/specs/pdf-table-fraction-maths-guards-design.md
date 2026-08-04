# PDF table/fraction detection: maths-content guards

## Problem

Comparing the PDF pipeline's `dump_markdown` output against Notion-exported reference Markdown for 10 new exercise-sheet PDFs (`notes/exercise_sheets/`) surfaced a second recurring corruption, distinct from the operator-glyph bug already fixed (`docs/specs/pdf-maths-operator-glyphs-design.md`): small aligned maths constructs — `\binom`-style vectors, `\cases` piecewise definitions, side-by-side binomial-coefficient pairs, multi-term fraction sums — get misdetected by two existing, purely geometric reconstruction passes:

- **`reconstruct_tables`** (bug B) misreads them as GFM pipe tables. Hit 9 of the 10 documents in the comparison; worst case Ue9.pdf Beispiel 9.3, a 6-row table of `�`-and-fragment garbage where an inclusion-exclusion formula should be.
- **`reconstruct_fractions`** (bug D) misreads a `\binom`-flanked two-row vector as a bare numerator/denominator fraction pair — `Analysis_2_Blatt7_2026.pdf`'s six 3-component vector fields all became nested `\frac{a}{\frac{b}{c}}`.

## Root cause

`try_table_at` (table detection) and `find_fraction_pair` (bare-fraction pairing) both look for geometric patterns — row alignment into shared column gutters, or vertical stacking with horizontal overlap — with no way to ask whether the content they've found is actually *one maths construct* rather than tabular data or a genuine bar-less fraction. A `\binom` vector's two rows satisfy `find_fraction_pair`'s stacking/overlap test exactly as well as a real fraction does; a `\cases` block's aligned value/condition columns satisfy `try_table_at`'s gutter/fill-ratio test exactly as well as real tabular data does. Neither detector has ever had a signal to tell them apart — this is the same shape of gap as the operator-glyph bug (a detector working with less information than the document actually encodes), not a coincidence.

The fix for the operator-glyph bug (`docs/specs/pdf-maths-operator-glyphs-design.md`) makes this fixable now: `latex.rs`/`extract.rs` recognize CMEX's large paren/brace delimiter glyphs as real, maths-family (`Family::Extensible`) characters instead of dropping them. Those delimiters are exactly the signal that distinguishes a `\binom`-flanked vector from a bare fraction, and (via general maths-family density) a `\cases`/matrix block from real tabular data.

## Design

### Table guard (`try_table_at`, `src-tauri/src/pdf/layout.rs`)

After a candidate window passes today's existing gutter/seed-tabularity/fill-ratio checks, compute its **maths coverage**: for each row in the window, call `maths_runs` (the existing per-row seed-and-grow maths-region detector, reused as-is with that row's own font size) and total how many non-whitespace characters across the whole window fall inside *some* row's detected run. If that fraction clears a threshold, `try_table_at` returns `None` for this candidate instead of `Some(TableMatch)` — the same rejection shape as today's existing `logical_rows.len() < TABLE_MIN_ROWS` / fill-ratio checks. `reconstruct_tables` already handles a `None` result by advancing past `start` and leaving those rows for normal processing, unchanged.

The exact threshold is an implementation-time constant, tuned against the real corpus (same empirical-verification discipline as the operator-glyph work) rather than picked here — it needs to reject Ue9 Beispiel 9.2's side-by-side binomial pairs and Blatt12's Heaviside `\cases` block while leaving the existing `table_test.pdf` fixtures (simple table, wrapped-cell table, 79-row repeating table — none of which are maths-heavy) untouched.

### Fraction-pair guard (`find_fraction_pair`, same file)

Before accepting a candidate `(numerator, denominator)` pair, scan the lines strictly between them (and immediately bracketing the pair) for one whose content is a large paren/brace glyph — recognizable via `Family::Extensible`, per the operator-glyph fix. If such a delimiter line's vertical extent spans the candidate pair's combined extent, the pair is rejected: `continue` past this candidate in `find_fraction_pair`'s search loop, the same rejection shape as the existing `crosses_a_paragraph_break` and gap/overlap checks. No delimiter found → pair as a bare fraction, exactly as today.

### Fallback behavior

Rejected content is not given any special second-pass handling — it falls through to whatever already happens today for a row/line neither reconstruction pass claims: independent per-row `build_line`, each row's own `maths_runs`-detected span rendering as its own inline or display maths. A matrix or `\cases` block stops being shredded into corrupted table cells or wrapped in a wrong `\frac`, but does not render as one unified LaTeX matrix — multi-row notation stays out of scope per CLAUDE.md's existing stated non-goal. The precise shape of the fallback per construct type (one display block per row vs. something else) is confirmed against the real corpus during implementation, not asserted in advance here — consistent with this pipeline's established "judge by looking at real output" practice (`pdf/dump.rs`'s own stated purpose).

### Testing

- Unit tests in `layout_tests.rs` for both guards: synthetic `CharBox` rows shaped like a small matrix/`\binom`/`\cases` block (maths-heavy — must now be *rejected* by the relevant detector) alongside the existing positive table and fraction test cases (must remain *accepted*, unchanged). Existing tests in this file are the regression baseline; none should need to change.
- Real-document verification via `dump_markdown` against the specific anchors already identified: Ue9.pdf Beispiel 9.2 (side-by-side binomial coefficients) and Beispiel 9.3 (inclusion-exclusion sum), Analysis_2_Blatt7_2026.pdf's six vector fields, Analysis_2_Blatt11.pdf items 4/5/6, Analysis_2_Blatt12.pdf's Heaviside `\cases` block and items 4/5's matrices, Analysis_2_Blatt5_2026.pdf's `\iiint_K` misdetection.

## Out of scope

- **Multi-row LaTeX reconstruction** (`\begin{pmatrix}`/`\begin{cases}`) — stays a non-goal per CLAUDE.md; this spec only stops false-positive misdetection, it does not add positive multi-row rendering.
- **Bug C** (exponent/subscript placement) — separate spec, despite being found in the same comparison pass.
- **Genuinely non-maths table false positives** already documented in `docs/specs/pdf-table-reconstruction-design.md` (the header/data alignment-mismatch case) — unaffected by this guard, not touched here.
- **The bullet-marker `U+FFFD` issue** noted in the operator-glyphs spec's real-corpus re-validation section — confirmed unrelated (`Family::Text`, a list-marker recognition gap), not addressed here.
