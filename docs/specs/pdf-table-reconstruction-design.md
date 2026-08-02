# PDF Table Reconstruction Design

**Goal:** Reconstruct tabular data in a PDF's text layer into GFM pipe-table Markdown, instead of today's behavior — every row of every table currently collapses into one run-on paragraph, with cells glued together using ordinary word-space synthesis and no row or column structure at all.

**Why now:** Second of four subsystems closing the gap with PDF import quality elsewhere (Notion cited as the comparison point when this effort started — see [[pdf-multi-column-reading-order-design]] for the first, multi-column reading order). Images/figures and general structure-detection quality are the remaining two, each independent, each a separate future spec.

**Non-goals (out of scope for this spec):**
- Joining a table across a page break. Each page's table rows build their own independent `Block::Table` — including a repeated header row on a later page, which is genuinely present in the source PDF's text layer and is not a bug to deduplicate.
- Detecting ruled/bordered table lines (drawn vector graphics). `layout.rs` and this new module read only the PDF's text layer (`CharBox`), never vector paths — detection is purely geometric, based on text alignment, exactly like the multi-column work. Whether the source table has visible borders is invisible to this pipeline and irrelevant to the design.
- A table with no natural header row, or a multi-row header. The first detected row is always treated as the GFM header row.
- General markdown-special-character escaping outside table cells. Only `|` inside a table cell is escaped (`\|`), since it would otherwise corrupt that row's own column structure; nothing elsewhere in the pipeline escapes markdown syntax today, and this stays scoped to what table rendering actually requires.
- **A table whose header row uses different horizontal alignment than its data rows — e.g. a centered header over left-aligned data — especially with narrow columns and short content.** Found during implementation, verified against `table_test.pdf`'s Unicode test table (`Character | Meaning`, single-symbol data rows): `table_gutters`' seed is drawn from the first two physical rows (header + first data row), and if their content sits at meaningfully different x-positions purely because of the alignment difference — not because of a real extra column — the union of their character spans can leave a spurious gap, producing an extra column that isn't really there. Fixing this properly means reworking seed selection (e.g. preferring a pair of *data* rows over a header-inclusive pair, or requiring gutter agreement across more than two rows before trusting one) — a large enough change to warrant its own design pass rather than a threshold tweak. The simple data table, the wrapped-cell table, and the 79-row repeating table (all left-aligned throughout) are unaffected and verified working.

---

## Background: current behavior, confirmed against a real document

A test PDF (`notes/table_test.pdf`, generated via `.null/scratch/generate_table_test_pdf.py` using ReportLab — a real PDF with a genuine pdfium-extracted text layer, not a synthetic fixture) contains three tables: a simple 6-column data table, a 3-column table where one cell wraps across two lines, and a 79-row table split across three pages with a repeated header row.

Running the existing `NULL_NOTES_PDF=../notes/table_test.pdf cargo test dump_markdown -- --ignored --nocapture` diagnostic confirms the failure mode directly:

```
ID Name Category Amount Date Status 001 Alpha Project Research 1250.50 2026-01-15 Complete 002 Beta System...
```

Row and column structure are both gone — the whole table reflows into one paragraph, because the vertical gap between table rows is small enough that `group_blocks`'s existing paragraph-continuation logic treats each row as a wrapped continuation line of the row before it. There is also a concrete correctness bug in the wrapped-cell table: `"...from PDF files.Team A"` — a wrapped cell's last line and the next cell's content end up directly adjacent with no space, because the pipeline has no concept that these are different cells belonging to different rows.

## Why detection can't happen at the `Line`/`Block` level

By the time `group_lines` produces a `Line`, per-character x-position is already gone — `Line.content: Vec<Inline>` holds text spans and maths strings, not glyph coordinates. Table detection fundamentally needs sub-row x-positions (to find cell boundaries), so it has to run at the same stage as the existing fraction-sum reconstruction: on the raw `Vec<Vec<(usize, CharBox)>>` rows `group_lines` builds internally, before `build_line` collapses each row into `Inline`s.

## Architecture

**Carrier mechanism:** a new `Inline::TableRow(Vec<Vec<Inline>>, bool)` variant — one logical table row's cells (each cell itself a `Vec<Inline>`, reusing the exact same inline representation everything else already uses, so a cell can hold bold/italic spans or inline maths for free), plus a flag marking whether this is the first row of its own detected table. A new pass, `reconstruct_tables`, runs inside `group_lines` alongside the existing `reconstruct_fraction_sums`, consuming raw rows and producing finished `Line`s whose `content` is `vec![Inline::TableRow(cells, is_first_row)]`. `group_blocks` gains one new rule: a run of consecutive `TableRow`-only `Line`s merges into one `Block::Table { rows: Vec<Vec<Vec<Inline>>> }` (first row = header) — using the flag, not a vertical-gap measurement, to decide where one table ends and the next begins (see Detection algorithm below for why the flag turned out to be necessary, not just the cells).

This keeps `group_lines`'s signature and every existing caller — including the ~40 tests in `layout_tests.rs` that call it directly — completely unchanged. The alternative (changing what `group_lines` returns so a table doesn't have to pretend to be a `Line`) is conceptually a little cleaner, but touches that return type everywhere it's consumed for no functional benefit, and was rejected on exactly the blast-radius grounds that make the `TableRow` carrier the safer choice.

**Implementation location:** `reconstruct_tables` and its helpers live directly in `src-tauri/src/pdf/layout.rs`, alongside `reconstruct_fraction_sums` — not a separate `table.rs` module as originally sketched here. Table detection has to call back into `group_lines`'s own tail and reuse `build_line`, the same coupling that already justified keeping fraction-sum reconstruction in this file; a separate module would have created a circular dependency between it and `layout.rs`. Still pure `CharBox`/`Line`/`Inline` logic, no pdfium dependency, fully unit-tested in `layout_tests.rs`.

## Detection algorithm

1. **Shared column gutters.** Unlike the multi-column work — which only needed each row's own overall left/right extent — a table needs *sub-row* boundaries shared across many rows. This merges every individual character's x-interval (not each row's collapsed extent, the way `columns.rs::column_gutters` works on whole-row extents) across a candidate window of rows into covered ranges; the leftover gaps are candidate cell boundaries. Same union-of-intervals technique as the multi-column work, deliberately not shared code (different granularity, different constants — same "duplicate the small primitive, keep modules decoupled" precedent `columns.rs` already set against `layout.rs`), and tuned to a **much smaller** gutter width: table cell padding is far narrower than a page-column gutter, so this needs its own constant, empirically checked against `table_test.pdf` rather than reused from `columns.rs`'s `MIN_GUTTER_EMS`.

2. **Greedy row-by-row growth.** Start with the smallest possible window (2 rows). If they share a valid, consistent gutter set, tentatively accept and keep extending one row at a time:
   - A row that has content in **most** of the established cells is a new full logical row.
   - A row that has content in **exactly one** cell is a wrapped-cell continuation: append its text (space-joined) onto that same cell in the logical row directly above it, rather than starting a new row. This is exactly the shape `table_test.pdf`'s wrapped table takes — `["Parser Core", "Handles extraction of text blocks, tables, columns, and", "Team A"]` followed by a continuation row with content in only the description column (`"and document metadata from PDF files."`).
   - A row that crosses an established gutter (a character straddles where a boundary should be) or is too sparse to be either of the above ends the growth.
3. **Acceptance bar.** A candidate is only kept once growth stops if it has **at least 2 logical rows and at least 2 columns**, with most (row, cell) slots non-empty. Anything short of that is released back to normal `build_line`/paragraph processing untouched — same conservative, under-detection-biased philosophy as the multi-column work: a missed table reproduces today's known-bad paragraph collapse, while a false-positive would corrupt content that already renders correctly.

**Two correctness bugs found only by real-document verification** (both fixed, both covered by regression tests):
- **Seed tabularity.** The initial 2-row seed originally only checked that the *union* of the two rows' characters left a gap somewhere — but two entirely unrelated rows of different lengths (an existing test's maths numerator and an unrelated line below it) can produce a spurious gutter purely from their different content lengths, even though neither row is itself tabular. Fix: both seed rows must independently show real multi-cell structure (≥2 filled cells) under the candidate gutters before they're trusted.
- **Table-boundary vs. block-gap heuristic.** A wrapped cell's continuation line folds into its anchor row's own `Line` rather than becoming a `Line` of its own, so the y-gap from that anchor to the *next* table row is irregular by design — bigger than an ordinary row-to-row gap. `group_blocks`'s existing vertical-gap heuristic (built for ordinary prose, where row height is uniform) misread that irregularity as "the table ended here" and split one multi-row table into several one-row tables. Fixed by the `is_first_row` flag on `Inline::TableRow` described above: `reconstruct_tables` already knows the true table boundary at the geometry level, so `group_blocks` uses that directly instead of re-deriving it from a gap measurement that was never a reliable signal for tables in the first place.

## Rendering

`blocks_to_markdown` gains a `Block::Table` case: header row as `| cell | cell |`, then the required `| --- | --- |` delimiter row, then each remaining row — the same shape `tiptap-markdown`'s own built-in table serializer expects (confirmed directly against its source: `Table` is one of its built-in-supported nodes, both parse via `markdown-it` and serialize to this exact GFM form), so the existing editor — which already has `Table`/`TableRow`/`TableHeader`/`TableCell` wired up with a slash command — round-trips this with **zero frontend changes**. Each cell's `Vec<Inline>` renders through the same inline-rendering helper already used for paragraphs; a literal `|` inside a cell is escaped to `\|`.

## Edge cases

- Fewer than 2 rows or 2 columns: not a table, left alone.
- Cell content that's itself maths renders as inline `$...$` within its cell, same as anywhere else in the document.
- A multi-page table produces one independent `Block::Table` per page; a repeated header on a later page is correct, not deduplicated (see Non-goals).
- A run of ordinary indented list items must not be mistaken for a 2-column table — covered by the acceptance bar's row/column/fill requirements, and by list detection already running as a separate, later classification in `group_blocks` that a `TableRow`-carrying `Line` never reaches.
- Only `|` is escaped in cell content; no broader escaping pass is introduced (see Non-goals).

## Testing

New `src-tauri/src/pdf/table_tests.rs`: a simple all-single-line table, a table with one wrapped 2-line cell (the concrete `Parser Core` shape from `table_test.pdf`), a too-sparse/too-short run that must not trigger (negative case), and a run of ordinary indented list items that must not be mistaken for a table (negative case).

**Real-document verification is required before this feature is considered done**, consistent with every prior change to this pipeline. Unlike the multi-column work, this is **not blocked** — `notes/table_test.pdf` already exists and the broken baseline above was already captured from it. The implementation plan's verification step re-runs the same `NULL_NOTES_PDF=../notes/table_test.pdf cargo test dump_markdown -- --ignored --nocapture` diagnostic and checks: the simple 6-column table renders as a clean GFM table; the wrapped-cell table's description cell comes out as one correctly-joined cell (closing the `"files.Team A"` bug directly); and the 79-row repeating table renders as three independent per-page tables, each with its own header row.
