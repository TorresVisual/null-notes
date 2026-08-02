# PDF Table Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Reconstruct tabular data in a PDF's text layer into GFM pipe-table Markdown, instead of today's behavior — every table row currently collapses into one run-on paragraph, cells glued together with ordinary word-space synthesis and no row or column structure at all.

**Architecture:** A new reconstruction pass, `reconstruct_tables`, added directly to `src-tauri/src/pdf/layout.rs` alongside the existing `reconstruct_fraction_sums` — same file, same integration point, for the same reason: a table's column boundaries are a property of raw `CharBox` x-positions, information a `Line` no longer carries once `build_line` collapses a row into `Inline`s. (The design spec sketched this as a separate `table.rs` module; placing it directly in `layout.rs` instead is a planning-time refinement, not a design change — it avoids a circular dependency between `layout.rs` and the new module, since table reconstruction must call back into `group_lines`'s own tail and reuse `build_line`, exactly the coupling that already justified keeping `reconstruct_fraction_sums` in this file rather than its own module.) A detected table's rows are carried through the existing `Vec<Line>` → `group_blocks` → `Vec<Block>` pipeline via a new `Inline::TableRow` variant and a new `Block::Table` variant, so `group_lines`'s signature and its ~40 existing direct tests are untouched.

**Tech Stack:** Rust, `src-tauri/src/pdf/layout.rs` (+ its test module `layout_tests.rs`). No new files, no new dependencies.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `layout.rs` must stay free of any `pdfium` dependency — everything in this plan is pure `CharBox`/`Line`/`Inline`/`Block` logic, already true of everything it builds on.
- `cargo clippy -- -D warnings` must pass clean before this is done.
- A table needs **at least 2 logical rows and at least 1 column gutter (2 columns)** to be reconstructed; anything short of that is left to normal paragraph processing, unchanged. See the design spec's Non-goals for what's explicitly out of scope (cross-page joining, ruled-line detection, multi-row headers).
- **Judge every task against the real document**, not synthetic fixtures alone: `NULL_NOTES_PDF=../notes/table_test.pdf cargo test --package null-notes --features pdf-native dump_markdown -- --ignored --nocapture`, run from `src-tauri/`. This PDF already exists (generated via `.null/scratch/generate_table_test_pdf.py`) and its broken baseline is already captured in the design spec — unlike prior PDF-pipeline work, this plan's real-document verification (Task 6) is not blocked.
- Small diffs where possible — Tasks 1-5 each land as their own commit — but this feature genuinely touches several existing functions (`Inline`, `Block`, `classify`, `finish_block`, `blocks_to_markdown`, `Line::text`/`is_blank`) because a new content type has to flow through the whole existing block pipeline. Task 1 isolates all of that plumbing into one self-contained, behavior-neutral commit before any table-detection logic is added.

---

## Background: what's broken and why, confirmed against a real document

Running `NULL_NOTES_PDF=../notes/table_test.pdf cargo test --package null-notes --features pdf-native dump_markdown -- --ignored --nocapture` today produces:

```
ID Name Category Amount Date Status 001 Alpha Project Research 1250.50 2026-01-15 Complete 002 Beta System...
```

Row and column structure are both gone: the vertical gap between table rows is small enough that `group_blocks`'s existing paragraph-continuation logic treats every row as a wrapped continuation of the one before it. The same document's wrapped-cell table shows a second, concrete bug: `"...from PDF files.Team A"` — a wrapped cell's last line and the next cell's content end up directly adjacent with no space, because nothing in the pipeline knows these are different cells belonging to different rows.

## Why this can't be detected at the `Line`/`Block` level

By the time `group_lines` produces a `Line`, per-character x-position is gone — `Line.content: Vec<Inline>` holds text spans and maths strings, not glyph coordinates. Column-boundary detection needs sub-row x-positions, so it has to run on the same raw `Vec<Vec<(usize, CharBox)>>` rows `reconstruct_fraction_sums` already consumes, inside `group_lines`, before `build_line` collapses each row.

---

### Task 1: Data model — `Inline::TableRow`, `Block::Table`, and every exhaustive match they touch

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Produces: `Inline::TableRow(Vec<Vec<Inline>>)` (new enum variant — one row's cells, each cell itself a `Vec<Inline>`), `Block::Table { rows: Vec<Vec<Vec<Inline>>> }` (new enum variant — first row is always the header, per the design spec's Non-goals).
- This task is deliberately behavior-neutral: nothing yet *produces* an `Inline::TableRow`, so every existing test must still pass unchanged. It exists to isolate the mechanical "make every exhaustive match over `Inline` compile" work from the actual detection logic in later tasks.

- [ ] **Step 1: Add the two new variants**

In `src-tauri/src/pdf/layout.rs`, find the `Inline` enum:

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Inline {
    Text(Span),
    /// The LaTeX source, without delimiters. Text rather than an image so it can
    /// be copied into a prompt, searched, and edited in place.
    Maths(String),
}
```

Replace with:

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Inline {
    Text(Span),
    /// The LaTeX source, without delimiters. Text rather than an image so it can
    /// be copied into a prompt, searched, and edited in place.
    Maths(String),
    /// One table row's cells, each a `Vec<Inline>` in its own right so a cell
    /// can hold bold/italic spans or inline maths for free. A carrier only —
    /// `group_blocks` merges consecutive `TableRow`-only `Line`s into one
    /// `Block::Table`; see `reconstruct_tables`.
    TableRow(Vec<Vec<Inline>>),
}
```

Find the `Block` enum:

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Heading { level: u8, content: Vec<Inline> },
    Paragraph { content: Vec<Inline> },
    Code { text: String },
    /// A standalone equation, cropped whole rather than inlined into a
    /// paragraph.
    MathsDisplay { latex: String },
    ListItem {
        ordered: bool,
        number: Option<u32>,
        depth: usize,
        content: Vec<Inline>,
    },
}
```

Replace with:

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Heading { level: u8, content: Vec<Inline> },
    Paragraph { content: Vec<Inline> },
    Code { text: String },
    /// A standalone equation, cropped whole rather than inlined into a
    /// paragraph.
    MathsDisplay { latex: String },
    ListItem {
        ordered: bool,
        number: Option<u32>,
        depth: usize,
        content: Vec<Inline>,
    },
    /// Every row's cells, first row always the header — a table with no
    /// natural header row is out of scope (see the design spec's
    /// Non-goals).
    Table { rows: Vec<Vec<Vec<Inline>>> },
}
```

- [ ] **Step 2: Fix `Line::text()` and `Line::is_blank()`**

Find:

```rust
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter_map(|i| match i {
                Inline::Text(span) => Some(span.text.as_str()),
                Inline::Maths(_) => None,
            })
            .collect()
    }

    fn is_blank(&self) -> bool {
        self.text().trim().is_empty() && !self.content.iter().any(is_maths)
    }
```

Replace with:

```rust
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter_map(|i| match i {
                Inline::Text(span) => Some(span.text.as_str()),
                Inline::Maths(_) | Inline::TableRow(_) => None,
            })
            .collect()
    }

    fn is_blank(&self) -> bool {
        // A table-row line carries no `Text`/`Maths` content of its own by
        // this measure (its content is nested one level deeper, inside each
        // cell), so without this check a real table row would be filtered
        // out as blank before `classify` ever saw it.
        self.text().trim().is_empty()
            && !self.content.iter().any(is_maths)
            && !matches!(self.content.as_slice(), [Inline::TableRow(_)])
    }
```

- [ ] **Step 3: Fix the remaining five exhaustive matches over `Inline`**

None of these five call sites can ever actually receive an `Inline::TableRow` at runtime — Task 4 makes `classify` divert every `TableRow`-carrying `Line` to its own code path before any of these functions run on it — but the match has to compile regardless of what a *particular* call site would contain, since `Inline` is a shared enum. Each gets the same safe, no-op-shaped arm the existing `Inline::Text(_)`/`Inline::Maths(_)` arms already use for "not applicable here".

In `reconstruct_fraction_sums`, find:

```rust
        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
        });
```

Replace with:

```rust
        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_) => false,
        });
```

In `build_line`, find the **second** occurrence of that same three-line shape (it is immediately followed by `let right = row` rather than a blank line and `let (num_x0, num_x1)`):

```rust
    let is_display_maths = content.iter().any(is_maths)
        && content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
        });
```

Replace with:

```rust
    let is_display_maths = content.iter().any(is_maths)
        && content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_) => false,
        });
```

In `join_lines`, find:

```rust
        for inline in &line.content {
            match inline {
                Inline::Maths(latex) => out.push(Inline::Maths(latex.clone())),
                Inline::Text(span) => {
                    for ch in span.text.chars() {
                        push_text(&mut out, ch, span.bold, span.italic);
                    }
                }
            }
        }
```

Replace with:

```rust
        for inline in &line.content {
            match inline {
                Inline::Maths(latex) => out.push(Inline::Maths(latex.clone())),
                Inline::Text(span) => {
                    for ch in span.text.chars() {
                        push_text(&mut out, ch, span.bold, span.italic);
                    }
                }
                // Unreachable in practice: `classify` diverts a table-row
                // line before it ever reaches `join_lines` (only
                // Heading/List/Prose-kind lines do). Kept as a no-op rather
                // than a panic — see CLAUDE.md on trusting internal
                // invariants without crashing if one is ever violated.
                Inline::TableRow(_) => {}
            }
        }
```

In `finish_block`'s `LineKind::MathsDisplay` arm, find:

```rust
            latex: lines
                .iter()
                .flat_map(|l| l.content.iter())
                .filter_map(|i| match i {
                    Inline::Maths(latex) => Some(latex.as_str()),
                    Inline::Text(_) => None,
                })
                .collect::<Vec<_>>()
                .join(" "),
```

Replace with:

```rust
            latex: lines
                .iter()
                .flat_map(|l| l.content.iter())
                .filter_map(|i| match i {
                    Inline::Maths(latex) => Some(latex.as_str()),
                    Inline::Text(_) | Inline::TableRow(_) => None,
                })
                .collect::<Vec<_>>()
                .join(" "),
```

In `render_content`, find:

```rust
        let span = match inline {
            Inline::Maths(latex) => {
                out.push_str(&format!("${latex}$"));
                continue;
            }
            Inline::Text(span) => span,
        };
```

Replace with:

```rust
        let span = match inline {
            Inline::Maths(latex) => {
                out.push_str(&format!("${latex}$"));
                continue;
            }
            Inline::Text(span) => span,
            // Unreachable: a cell's own content never nests another table
            // row, and `render_content` is never called on a `Block::Table`
            // directly (Task 5 renders each cell's `Vec<Inline>` through
            // this function instead).
            Inline::TableRow(_) => continue,
        };
```

In `combined_maths_latex`, find:

```rust
        .filter_map(|i| match i {
            Inline::Maths(s) => Some(s.as_str()),
            Inline::Text(_) => None,
        })
```

Replace with:

```rust
        .filter_map(|i| match i {
            Inline::Maths(s) => Some(s.as_str()),
            Inline::Text(_) | Inline::TableRow(_) => None,
        })
```

- [ ] **Step 4: Write tests confirming the plumbing behaves correctly**

Add to `src-tauri/src/pdf/layout_tests.rs`:

```rust
fn table_row_line(cells: Vec<Vec<Inline>>) -> Line {
    Line {
        content: vec![Inline::TableRow(cells)],
        x: 72.0,
        right: 200.0,
        y: 700.0,
        font_size: BODY,
        fixed_pitch: false,
        is_display_maths: false,
        ends_hyphenated: false,
    }
}

#[test]
fn a_table_row_line_is_not_blank() {
    let line = table_row_line(vec![
        vec![Inline::Text(Span { text: "a".into(), bold: false, italic: false })],
        vec![Inline::Text(Span { text: "b".into(), bold: false, italic: false })],
    ]);
    assert!(!line.is_blank());
}

#[test]
fn a_table_row_lines_own_text_is_empty() {
    let line = table_row_line(vec![vec![Inline::Text(Span {
        text: "cell".into(),
        bold: false,
        italic: false,
    })]]);
    assert_eq!(line.text(), "");
}
```

- [ ] **Step 5: Run tests to verify everything still passes**

Run (from `src-tauri/`): `cargo test --package null-notes layout_tests`
Expected: PASS — every existing test unchanged, plus the two new ones. This confirms the new variants compile cleanly through every existing exhaustive match with zero behavior change to anything that doesn't construct a `TableRow`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): add TableRow/Table data model for table reconstruction"
```

---

### Task 2: Column-gutter geometry — `table_gutters`, `split_row_into_cells`, `cell_has_content`, `row_crosses_gutters`

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (add near `row_x_extent`, before `split_into_terms`)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `median` (existing, same file), `CharBox` (existing).
- Produces: `pub(super) fn table_gutters(rows: &[Vec<CharBox>]) -> Option<Vec<f32>>`, `pub(super) fn split_row_into_cells(row: &[(usize, CharBox)], cut_xs: &[f32]) -> Vec<Vec<(usize, CharBox)>>`, `pub(super) fn cell_has_content(cell: &[(usize, CharBox)]) -> bool`, `pub(super) fn row_crosses_gutters(row: &[CharBox], cut_xs: &[f32]) -> bool` — all used by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `layout_tests.rs`:

```rust
#[test]
fn table_gutters_finds_the_shared_gap_between_two_rows() {
    let mut row1 = set("ID", 72.0, 700.0, Style::default());
    row1.extend(set("Name", 100.0, 700.0, Style::default()));
    let mut row2 = set("1", 72.0, 688.0, Style::default());
    row2.extend(set("Alice", 100.0, 688.0, Style::default()));

    let gutters = table_gutters(&[row1, row2]).expect("expected a shared gutter");

    assert_eq!(gutters.len(), 1);
    assert!(gutters[0] > 82.0 && gutters[0] < 100.0);
}

// Different word lengths across the two lines mean the union of their
// non-whitespace spans has no gap left over anywhere — the same property
// that keeps ordinary prose from ever being mistaken for a table.
#[test]
fn table_gutters_is_none_when_rows_share_no_gap() {
    let row1 = set("hello world today", 72.0, 700.0, Style::default());
    let row2 = set("goodbye friend now", 72.0, 688.0, Style::default());
    assert_eq!(table_gutters(&[row1, row2]), None);
}

#[test]
fn split_row_into_cells_buckets_by_the_cut_points() {
    let row: Vec<(usize, CharBox)> = set("AB", 72.0, 700.0, Style::default())
        .into_iter()
        .chain(set("CD", 100.0, 700.0, Style::default()))
        .enumerate()
        .collect();

    let cells = split_row_into_cells(&row, &[90.0]);

    assert_eq!(cells.len(), 2);
    assert_eq!(cells[0].iter().map(|(_, c)| c.ch).collect::<String>(), "AB");
    assert_eq!(cells[1].iter().map(|(_, c)| c.ch).collect::<String>(), "CD");
}

#[test]
fn cell_has_content_is_false_for_whitespace_or_nothing() {
    let whitespace_only: Vec<(usize, CharBox)> =
        set("  ", 72.0, 700.0, Style::default()).into_iter().enumerate().collect();
    assert!(!cell_has_content(&whitespace_only));
    assert!(!cell_has_content(&[]));

    let real: Vec<(usize, CharBox)> =
        set("x", 72.0, 700.0, Style::default()).into_iter().enumerate().collect();
    assert!(cell_has_content(&real));
}

#[test]
fn row_crosses_gutters_detects_a_straddling_character() {
    let row = set("straddle", 85.0, 700.0, Style::default());
    assert!(row_crosses_gutters(&row, &[87.0]));
}

#[test]
fn row_crosses_gutters_is_false_when_nothing_straddles() {
    let row = set("AB", 72.0, 700.0, Style::default());
    assert!(!row_crosses_gutters(&row, &[90.0]));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package null-notes table_gutters split_row_into_cells cell_has_content row_crosses_gutters`
Expected: FAIL to compile — none of these functions exist yet.

- [ ] **Step 3: Add the constants and implement**

In `src-tauri/src/pdf/layout.rs`, find (near the other tuning constants):

```rust
const MATHS_BRIDGE_EMS: f32 = 2.5;
```

Add immediately after it:

```rust
// Table cell padding is far narrower than a page-column gutter — chosen
// against notes/table_test.pdf's own ~12pt (ReportLab's LEFTPADDING +
// RIGHTPADDING) minimum cell spacing at an 11-12pt body size, comfortably
// above any ordinary inter-word gap.
const TABLE_MIN_GUTTER_EMS: f32 = 0.8;
// A table needs at least this many logical rows (a header plus at least
// one data row) to be worth reconstructing.
const TABLE_MIN_ROWS: usize = 2;
// ...and at least this fraction of its (row, cell) slots holding real
// content, so a coincidentally-aligned run of mostly-blank lines is never
// mistaken for a data grid.
const TABLE_MIN_FILL_RATIO: f32 = 0.5;
```

Add near `row_x_extent`/`row_y`/`row_font_size` (before `split_into_terms`):

```rust
/// Finds column-boundary x-positions shared by every row in `rows`, by
/// merging every non-whitespace character's x-interval — not each row's
/// own collapsed extent the way `row_x_extent` works, since a table needs
/// *sub-row* boundaries — into covered ranges. The gaps left over are
/// candidate cell boundaries, each returned as its midpoint. `None` when
/// there's no gap wide enough to be a real cell boundary rather than an
/// ordinary word-space within one cell.
///
/// Different rows' words rarely start and end at exactly the same x, so
/// merging *across* rows (not measuring each row alone) is what makes this
/// robust: two rows of ordinary prose with different word lengths leave no
/// gap anywhere in the union, while two rows of real tabular data — whose
/// column starts are genuinely aligned — do.
pub(super) fn table_gutters(rows: &[Vec<CharBox>]) -> Option<Vec<f32>> {
    let mut intervals: Vec<(f32, f32)> = rows
        .iter()
        .flatten()
        .filter(|c| !c.ch.is_whitespace())
        .map(|c| (c.x, c.x + c.width))
        .collect();
    if intervals.is_empty() {
        return None;
    }
    intervals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut merged: Vec<(f32, f32)> = Vec::new();
    for (s, e) in intervals {
        match merged.last_mut() {
            Some((_, last_e)) if s <= *last_e => *last_e = last_e.max(e),
            _ => merged.push((s, e)),
        }
    }

    let mut sizes: Vec<f32> = rows.iter().flatten().map(|c| c.font_size).collect();
    let threshold = median(&mut sizes).max(1.0) * TABLE_MIN_GUTTER_EMS;

    let gutters: Vec<f32> = merged
        .windows(2)
        .filter(|w| w[1].0 - w[0].1 >= threshold)
        .map(|w| (w[0].1 + w[1].0) / 2.0)
        .collect();

    (!gutters.is_empty()).then_some(gutters)
}

/// Splits `row` into `cut_xs.len() + 1` cells at the given x-positions,
/// preserving each character's original stream index — `build_line` (used
/// on each cell's characters in Task 3) sorts by that index, not by `x`.
pub(super) fn split_row_into_cells(
    row: &[(usize, CharBox)],
    cut_xs: &[f32],
) -> Vec<Vec<(usize, CharBox)>> {
    let mut cells: Vec<Vec<(usize, CharBox)>> = vec![Vec::new(); cut_xs.len() + 1];
    for &(index, ch) in row {
        let cell = cut_xs.iter().filter(|&&cx| ch.x > cx).count();
        cells[cell].push((index, ch));
    }
    cells
}

pub(super) fn cell_has_content(cell: &[(usize, CharBox)]) -> bool {
    cell.iter().any(|(_, c)| !c.ch.is_whitespace())
}

/// Whether any character in `row` straddles one of `cut_xs` — the signal
/// that this row does not belong to the table the gutters were established
/// from, rather than merely being one more row of it.
pub(super) fn row_crosses_gutters(row: &[CharBox], cut_xs: &[f32]) -> bool {
    row.iter()
        .any(|c| cut_xs.iter().any(|&cx| c.x < cx && c.x + c.width > cx))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes table_gutters split_row_into_cells cell_has_content row_crosses_gutters`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): add column-gutter geometry for table detection"
```

---

### Task 3: `reconstruct_tables` — growing-window detection with wrapped-cell merging, wired into `group_lines`

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (add after `reconstruct_fraction_sums`; modify `group_lines`'s tail)
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `table_gutters`, `split_row_into_cells`, `cell_has_content`, `row_crosses_gutters` (Task 2), `row_x_extent`, `row_y`, `row_font_size`, `build_line`, `push_text` (all existing, same file), `TABLE_MIN_ROWS`, `TABLE_MIN_FILL_RATIO` (Task 2).
- Produces: `fn reconstruct_tables(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>)` — same shape as `reconstruct_fraction_sums`, wired into `group_lines` the same way.

- [ ] **Step 1: Write the failing tests**

These test `group_lines` directly rather than the full `chars_to_markdown` pipeline — `Block::Table` and its GFM rendering don't exist until Tasks 4-5, so the observable, independently-checkable result at this stage is the shape of the `Line`s `group_lines` produces, not final markdown text.

Add to `layout_tests.rs`:

```rust
fn table_row_cell_text(cell: &[Inline]) -> String {
    cell.iter()
        .filter_map(|i| match i {
            Inline::Text(span) => Some(span.text.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_simple_two_column_table_becomes_table_row_lines() {
    let mut chars = set("ID", 72.0, 700.0, Style::default());
    chars.extend(set("Name", 100.0, 700.0, Style::default()));
    chars.extend(set("1", 72.0, 688.0, Style::default()));
    chars.extend(set("Alice", 100.0, 688.0, Style::default()));
    chars.extend(set("2", 72.0, 676.0, Style::default()));
    chars.extend(set("Bob", 100.0, 676.0, Style::default()));

    let lines = group_lines(&chars);

    assert_eq!(lines.len(), 3);
    for line in &lines {
        assert!(
            matches!(line.content.as_slice(), [Inline::TableRow(_)]),
            "expected every line to be a table row, got {:?}",
            line.content
        );
    }
    let Inline::TableRow(header_cells) = &lines[0].content[0] else {
        panic!("expected TableRow");
    };
    assert_eq!(header_cells.len(), 2);
    assert_eq!(table_row_cell_text(&header_cells[0]), "ID");
    assert_eq!(table_row_cell_text(&header_cells[1]), "Name");
}

// Mirrors table_test.pdf's wrapped-cell table: a row with all three cells
// filled, followed by a row with content in only the middle (Description)
// cell — the signature of a wrapped line, not a new row. This is the exact
// shape that produces the "files.Team A" bug in today's pipeline.
#[test]
fn a_wrapped_cell_merges_into_the_row_above_it_instead_of_a_new_row() {
    let mut chars = set("Component", 72.0, 700.0, Style::default());
    chars.extend(set("Description", 150.0, 700.0, Style::default()));
    chars.extend(set("Owner", 430.0, 700.0, Style::default()));

    chars.extend(set("Core", 72.0, 688.0, Style::default()));
    chars.extend(set("Handles extraction of text", 150.0, 688.0, Style::default()));
    chars.extend(set("A", 430.0, 688.0, Style::default()));

    // Continuation row: only the Description column has content.
    chars.extend(set("and more here", 150.0, 676.0, Style::default()));

    let lines = group_lines(&chars);

    // Exactly 2 table-row lines — the continuation must not have become a
    // third.
    assert_eq!(lines.len(), 2);
    let Inline::TableRow(data_cells) = &lines[1].content[0] else {
        panic!("expected TableRow");
    };
    assert_eq!(
        table_row_cell_text(&data_cells[1]),
        "Handles extraction of text and more here"
    );
}

#[test]
fn a_lone_row_never_becomes_a_table_row_line() {
    let chars = set("just one row of text here", 72.0, 700.0, Style::default());
    let lines = group_lines(&chars);
    assert!(lines
        .iter()
        .all(|l| !matches!(l.content.as_slice(), [Inline::TableRow(_)])));
}

#[test]
fn two_rows_with_no_shared_gutter_produce_no_table_row_lines() {
    let mut chars = set("hello world today", 72.0, 700.0, Style::default());
    chars.extend(set("goodbye friend now", 72.0, 688.0, Style::default()));
    let lines = group_lines(&chars);
    assert!(lines
        .iter()
        .all(|l| !matches!(l.content.as_slice(), [Inline::TableRow(_)])));
}
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cargo test --package null-notes a_simple_two_column_table_becomes_table_row_lines a_wrapped_cell_merges a_lone_row_never two_rows_with_no_shared_gutter`
Expected: `a_simple_two_column_table_becomes_table_row_lines` and `a_wrapped_cell_merges_into_the_row_above_it_instead_of_a_new_row` FAIL (no `Line` carries `Inline::TableRow` yet — `reconstruct_tables` doesn't exist). `a_lone_row_never_becomes_a_table_row_line` and `two_rows_with_no_shared_gutter_produce_no_table_row_lines` should already PASS (nothing produces `Inline::TableRow` at all yet) — confirm that too, as a baseline.

- [ ] **Step 3: Implement `reconstruct_tables` and wire it in**

Add to `src-tauri/src/pdf/layout.rs`, directly after `reconstruct_fraction_sums`:

```rust
/// Appends a wrapped cell's continuation content onto `cell`, space-joined
/// — a description that wraps across two PDF lines becomes one cell, not
/// two. Reuses the same `push_text` helper `join_lines` already uses to
/// join text runs.
fn append_cell_content(cell: &mut Vec<Inline>, extra: Vec<Inline>) {
    if extra.is_empty() {
        return;
    }
    if !cell.is_empty() {
        push_text(cell, ' ', false, false);
    }
    cell.extend(extra);
}

/// Every logical row this candidate found, and every physical row (primary
/// or wrapped-continuation) it absorbed, for the caller to mark consumed.
struct TableMatch {
    logical_rows: Vec<(usize, Vec<Vec<Inline>>)>,
    consumed_rows: Vec<usize>,
}

/// Attempts to grow a table starting at `plain[start]`. Establishes column
/// gutters from the first two rows, then greedily absorbs subsequent rows:
/// a row with content in most of the established cells is a new logical
/// row; a row with content in *exactly one* cell is a wrapped-cell
/// continuation, folded onto that cell in the row above; a row that
/// straddles a gutter, or has no content at all, ends the table. `None`
/// when the result doesn't clear `TABLE_MIN_ROWS`/`TABLE_MIN_FILL_RATIO` —
/// released back to normal paragraph processing rather than forced.
fn try_table_at(
    rows: &[Vec<(usize, CharBox)>],
    plain: &[Vec<CharBox>],
    start: usize,
) -> Option<TableMatch> {
    let cut_xs = table_gutters(&plain[start..start + 2])?;

    let cells_of = |row: &[(usize, CharBox)]| -> Vec<Vec<Inline>> {
        split_row_into_cells(row, &cut_xs)
            .into_iter()
            .map(|cell| if cell.is_empty() { Vec::new() } else { build_line(cell).content })
            .collect()
    };

    let mut consumed_rows: Vec<usize> = vec![start];
    let mut anchor_row = start;
    let mut anchor_cells = cells_of(&rows[start]);
    let mut logical_rows: Vec<(usize, Vec<Vec<Inline>>)> = Vec::new();

    let mut i = start + 1;
    while i < rows.len() {
        if row_crosses_gutters(&plain[i], &cut_xs) {
            break;
        }
        let raw_cells = split_row_into_cells(&rows[i], &cut_xs);
        let filled: Vec<usize> = raw_cells
            .iter()
            .enumerate()
            .filter(|(_, c)| cell_has_content(c))
            .map(|(idx, _)| idx)
            .collect();

        if filled.is_empty() {
            break;
        }
        if filled.len() == 1 {
            let cell_index = filled[0];
            let extra = if raw_cells[cell_index].is_empty() {
                Vec::new()
            } else {
                build_line(raw_cells[cell_index].clone()).content
            };
            append_cell_content(&mut anchor_cells[cell_index], extra);
            consumed_rows.push(i);
            i += 1;
            continue;
        }

        logical_rows.push((anchor_row, std::mem::take(&mut anchor_cells)));
        consumed_rows.push(i);
        anchor_row = i;
        anchor_cells = raw_cells
            .into_iter()
            .map(|cell| if cell.is_empty() { Vec::new() } else { build_line(cell).content })
            .collect();
        i += 1;
    }
    logical_rows.push((anchor_row, anchor_cells));

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

/// Finds and reconstructs runs of rows whose text aligns into a shared grid
/// of columns into `Line`s carrying `Inline::TableRow` — see the design
/// spec (`docs/specs/pdf-table-reconstruction-design.md`) for the full
/// detection rationale. Runs on the same raw rows `reconstruct_fraction_sums`
/// consumes, and for the same reason: this needs the raw `CharBox`
/// x-positions a `Line` no longer carries once `build_line` collapses a row.
fn reconstruct_tables(rows: Vec<Vec<(usize, CharBox)>>) -> (Vec<Line>, Vec<Vec<(usize, CharBox)>>) {
    let plain: Vec<Vec<CharBox>> = rows.iter().map(|r| r.iter().map(|(_, c)| *c).collect()).collect();
    let mut consumed = vec![false; rows.len()];
    let mut synthesized: Vec<Line> = Vec::new();

    let mut start = 0;
    while start < rows.len() {
        if consumed[start] || start + 1 >= rows.len() {
            start += 1;
            continue;
        }
        let Some(table) = try_table_at(&rows, &plain, start) else {
            start += 1;
            continue;
        };
        for &row_index in &table.consumed_rows {
            consumed[row_index] = true;
        }
        for (anchor_row, cells) in table.logical_rows {
            let anchor = &plain[anchor_row];
            let (x, right) = row_x_extent(anchor);
            synthesized.push(Line {
                content: vec![Inline::TableRow(cells)],
                x,
                right,
                y: row_y(anchor),
                font_size: row_font_size(anchor),
                fixed_pitch: false,
                is_display_maths: false,
                ends_hyphenated: false,
            });
        }
        start = table.consumed_rows.iter().copied().max().map(|m| m + 1).unwrap_or(start + 1);
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

Then modify `group_lines`'s tail. Find:

```rust
    merge_extensible_rows(&mut rows);
    let (mut lines, rows) = reconstruct_fraction_sums(rows);
    lines.extend(rows.into_iter().map(build_line));
    lines.sort_by(|a, b| b.y.partial_cmp(&a.y).unwrap_or(std::cmp::Ordering::Equal));
    lines
}
```

Replace with:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes a_simple_two_column_table_becomes_table_row_lines a_wrapped_cell_merges a_lone_row_never two_rows_with_no_shared_gutter`
Expected: PASS — all four, fully and finally, since these check `group_lines`'s own output directly rather than depending on Tasks 4-5.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run (from `src-tauri/`): `cargo test --package null-notes`
Expected: every existing `pdf::layout`/`pdf::extract` test still passes. A table-shaped run of rows is a genuinely new code path with no prior behavior to regress, so the only risk here is an existing fixture accidentally forming an unintended gutter — investigate any such failure as a new root cause, not a threshold to loosen blindly.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): detect and reconstruct table rows with wrapped-cell merging"
```

---

### Task 4: `classify`/`finish_block` — recognize table-row lines, merge into `Block::Table`

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `LineKind` (existing enum, same file), `Inline::TableRow` (Task 1), `Block::Table` (Task 1).
- Produces: `LineKind::Table` (new unit variant — deliberately payload-free so `LineKind` keeps its existing `Copy` derive; `finish_block` re-extracts each line's cells from `line.content` rather than carrying them in the enum).

- [ ] **Step 1: Write the failing test**

Add to `layout_tests.rs`:

```rust
#[test]
fn consecutive_table_row_lines_merge_into_one_table_block() {
    let mut chars = set("ID", 72.0, 700.0, Style::default());
    chars.extend(set("Name", 100.0, 700.0, Style::default()));
    chars.extend(set("1", 72.0, 688.0, Style::default()));
    chars.extend(set("Alice", 100.0, 688.0, Style::default()));

    let blocks = group_blocks(&reconstruct_fractions(group_lines(&chars)));

    assert_eq!(blocks.len(), 1);
    let Block::Table { rows } = &blocks[0] else {
        panic!("expected a single Block::Table, got {:?}", blocks[0]);
    };
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].len(), 2);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --package null-notes consecutive_table_row_lines_merge_into_one_table_block`
Expected: FAIL — `LineKind::Table` doesn't exist yet, so today every table-row `Line` gets classified as `Prose` and merged into one `Block::Paragraph` with garbled text instead.

- [ ] **Step 3: Implement**

Find the `LineKind` enum:

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
enum LineKind {
    Prose,
    Code,
    Heading(u8),
    List(bool, usize),
    MathsDisplay,
}
```

Replace with:

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
enum LineKind {
    Prose,
    Code,
    Heading(u8),
    List(bool, usize),
    MathsDisplay,
    Table,
}
```

Find `classify`:

```rust
fn classify(line: &Line, body: f32, left_margin: f32) -> LineKind {
    // Checked before everything else: a display equation is centred and set in
    // maths fonts, so heading and list detection would both misread it.
    if line.is_display_maths {
        return LineKind::MathsDisplay;
    }
```

Replace with:

```rust
fn classify(line: &Line, body: f32, left_margin: f32) -> LineKind {
    // Checked before everything else, for the same reason as the
    // display-maths check just below: a table row's own font size or
    // leading whitespace could otherwise misread as a heading or list.
    if matches!(line.content.as_slice(), [Inline::TableRow(_)]) {
        return LineKind::Table;
    }
    // Checked before everything else: a display equation is centred and set in
    // maths fonts, so heading and list detection would both misread it.
    if line.is_display_maths {
        return LineKind::MathsDisplay;
    }
```

Find `finish_block`'s match, and its `LineKind::Prose` arm specifically:

```rust
        LineKind::Prose => Block::Paragraph {
            content: join_lines(lines),
        },
    }
}
```

Replace with:

```rust
        LineKind::Prose => Block::Paragraph {
            content: join_lines(lines),
        },
        // Every line here was classified `Table` by `classify`, so its
        // content is always `[Inline::TableRow(cells)]` by construction —
        // `filter_map` rather than an unwrap/panic if that invariant is
        // ever violated, per CLAUDE.md.
        LineKind::Table => Block::Table {
            rows: lines
                .iter()
                .filter_map(|l| match l.content.as_slice() {
                    [Inline::TableRow(cells)] => Some(cells.clone()),
                    _ => None,
                })
                .collect(),
        },
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --package null-notes consecutive_table_row_lines_merge_into_one_table_block`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `cargo test --package null-notes`
Expected: PASS — `LineKind::Table` is a new arm on an existing `match`, added consistently everywhere `LineKind` is matched.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): merge consecutive table-row lines into Block::Table"
```

---

### Task 5: GFM rendering — `blocks_to_markdown` and `escape_table_cell`

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `render_content` (existing, same file), `Block::Table` (Task 1).
- Produces: `pub(super) fn escape_table_cell(text: &str) -> String` — used by `blocks_to_markdown`.

- [ ] **Step 1: Write the failing tests**

Add to `layout_tests.rs`. These re-check the end-to-end shape Task 3's tests already probed for, now that rendering exists, plus a dedicated escaping test:

```rust
#[test]
fn a_simple_table_renders_as_gfm() {
    let mut chars = set("ID", 72.0, 700.0, Style::default());
    chars.extend(set("Name", 100.0, 700.0, Style::default()));
    chars.extend(set("1", 72.0, 688.0, Style::default()));
    chars.extend(set("Alice", 100.0, 688.0, Style::default()));
    chars.extend(set("2", 72.0, 676.0, Style::default()));
    chars.extend(set("Bob", 100.0, 676.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(
        markdown.trim_end(),
        "| ID | Name |\n| --- | --- |\n| 1 | Alice |\n| 2 | Bob |"
    );
}

#[test]
fn a_wrapped_cell_produces_one_clean_data_row() {
    let mut chars = set("Component", 72.0, 700.0, Style::default());
    chars.extend(set("Description", 150.0, 700.0, Style::default()));
    chars.extend(set("Owner", 430.0, 700.0, Style::default()));
    chars.extend(set("Core", 72.0, 688.0, Style::default()));
    chars.extend(set("Handles extraction of text", 150.0, 688.0, Style::default()));
    chars.extend(set("A", 430.0, 688.0, Style::default()));
    chars.extend(set("and more here", 150.0, 676.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(
        markdown.trim_end(),
        "| Component | Description | Owner |\n\
         | --- | --- | --- |\n\
         | Core | Handles extraction of text and more here | A |"
    );
}

#[test]
fn a_literal_pipe_in_a_cell_is_escaped() {
    assert_eq!(escape_table_cell("a | b"), "a \\| b");
    assert_eq!(escape_table_cell("no pipes here"), "no pipes here");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --package null-notes a_simple_table_renders_as_gfm a_wrapped_cell_produces_one_clean_data_row a_literal_pipe_in_a_cell_is_escaped`
Expected: FAIL — `Block::Table` has no rendering arm in `blocks_to_markdown` yet (compile error on the non-exhaustive match once this arm is expected, or a runtime mismatch — see Step 3), and `escape_table_cell` doesn't exist.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/pdf/layout.rs`, near `render_content`:

```rust
/// GFM's pipe-table syntax uses `|` to separate cells, so a literal `|`
/// inside a cell's own content has to be escaped or it would corrupt that
/// row's column structure. Nothing else in this pipeline escapes markdown
/// syntax — every other block either renders characters safe to emit as-is,
/// or generates its own syntax (list markers, headings) rather than passing
/// arbitrary content through a character that means something structural.
/// Scoped to table cells because tables are the one place this pipeline's
/// own choice of output syntax collides with a character real prose can
/// contain.
pub(super) fn escape_table_cell(text: &str) -> String {
    text.replace('|', "\\|")
}
```

Find `blocks_to_markdown`'s match, and its final arm (`Block::ListItem`):

```rust
            Block::ListItem {
                ordered,
                number,
                depth,
                content,
            } => {
                let indent = "  ".repeat(*depth);
                let marker = match (ordered, number) {
                    (true, Some(n)) => format!("{n}."),
                    (true, None) => "1.".to_string(),
                    (false, _) => "-".to_string(),
                };
                parts.push(format!(
                    "{indent}{marker} {}",
                    render_content(content)
                ));
            }
        }
    }
```

Replace with:

```rust
            Block::ListItem {
                ordered,
                number,
                depth,
                content,
            } => {
                let indent = "  ".repeat(*depth);
                let marker = match (ordered, number) {
                    (true, Some(n)) => format!("{n}."),
                    (true, None) => "1.".to_string(),
                    (false, _) => "-".to_string(),
                };
                parts.push(format!(
                    "{indent}{marker} {}",
                    render_content(content)
                ));
            }
            Block::Table { rows } => {
                let mut table_lines: Vec<String> = Vec::new();
                for (index, row) in rows.iter().enumerate() {
                    let cells: Vec<String> = row
                        .iter()
                        .map(|cell| escape_table_cell(&render_content(cell)))
                        .collect();
                    table_lines.push(format!("| {} |", cells.join(" | ")));
                    if index == 0 {
                        let delimiter = vec!["---"; row.len()].join(" | ");
                        table_lines.push(format!("| {delimiter} |"));
                    }
                }
                parts.push(table_lines.join("\n"));
            }
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --package null-notes a_simple_table_renders_as_gfm a_wrapped_cell_produces_one_clean_data_row a_literal_pipe_in_a_cell_is_escaped`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `cargo test --package null-notes`
Expected: PASS — every existing test, plus every test from Tasks 1-5.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): render Block::Table as GFM pipe-table markdown"
```

---

### Task 6: Real-document verification and clippy

**Files:** none (verification only).

- [ ] **Step 1: Run the real-document diagnostic**

From `src-tauri/`:

```bash
NULL_NOTES_PDF=../notes/table_test.pdf cargo test --package null-notes --features pdf-native dump_markdown -- --ignored --nocapture
```

Expected, checked by hand against the three tables on page 0 and the repeating table on pages 1-3:

- The simple 6-column `ID | Name | Category | Amount | Date | Status` table renders as a clean GFM table with 5 rows (header + 4 data rows), each cell correctly separated.
- The 3-column wrapped-cell table (`Component | Description | Owner`) renders as a clean 3-row GFM table (header + 2 data rows), with the `Parser Core` row's Description cell reading as one correctly-joined cell — `"Handles extraction of text blocks, tables, columns, and document metadata from PDF files."` — closing the `"files.Team A"` bug directly (confirm the old glued-together text is gone).
- The 79-row repeating table renders as **three independent tables**, one per page, each with its own header row (`Index | Value | Description`) — per the design spec's Non-goals, this is correct, not a bug to fix.
- The Unicode table's row/column structure comes out correct (`✓ | Completed`, etc.) even though `中文`/`日本語` still render as placeholder boxes — that's a pre-existing font/glyph-mapping limitation in the test PDF's font, unrelated to and out of scope for this table-reconstruction work; only the table structure itself is being judged here.

If any of these is wrong, do not force a fix by loosening `TABLE_MIN_GUTTER_EMS`/`TABLE_MIN_FILL_RATIO` — re-run with `dump_line_pieces` (already present in `src-tauri/src/pdf/dump.rs`) against the same `NULL_NOTES_PDF` to see the actual row geometry, and treat it as a new root-cause investigation.

- [ ] **Step 2: Confirm the non-table worksheets are unaffected**

Run the same diagnostic against `notes/Analysis_1_Blatt2_2025.pdf` (or any other existing worksheet) and confirm its output is byte-identical to before this plan — none of these documents contain tables, so nothing about their rendering should have changed.

- [ ] **Step 3: Run clippy**

From `src-tauri/`: `cargo clippy -- -D warnings`
Expected: clean. Fix anything flagged in the new code before moving on.

- [ ] **Step 4: Commit any clippy fixups, if needed**

```bash
git add src-tauri/src/pdf/layout.rs
git commit -m "fix(pdf): address clippy warnings in table reconstruction"
```

(Skip this commit entirely if Step 3 was already clean.)
