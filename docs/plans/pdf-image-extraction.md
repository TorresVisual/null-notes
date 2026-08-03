# PDF Image Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.
>
> **This plan was written in a planning-only session.** No code from it has been implemented or tested yet — treat every step's "Expected: PASS" as a prediction to verify, not a confirmed result. Start a fresh worktree per superpowers:using-git-worktrees before Task 1.

**Goal:** Extract embedded raster images from a PDF's page content during Markdown-mode import, placing each one in correct reading order relative to the surrounding text — instead of today's behavior, where `extract.rs` reads only character glyphs and every image on a page is silently dropped.

**Architecture:** Rust extracts raw image bytes + page bounds via pdfium's page-object API (new, `extract.rs`), interleaves them into reading order using the same synthetic-`Line` pattern proven for tables but simpler — no wrapping/merging — via a new `Inline::ImageRef`/`Block::Image` pair (`layout.rs`), and emits the final Markdown with **placeholder** image references (`![](pdf-image://0)`) rather than real asset paths. `import_pdf_markdown` returns that markdown plus the raw image bytes; the frontend (`ImportButton.tsx`), *after* creating the note exactly as it does today, writes each image via the existing `api.assets.write` (the same call `NoteImage.tsx`'s own paste/drop handler already uses) and substitutes the real, `encodeSrc`-encoded path for each placeholder before saving. This preserves the existing "a PDF that turns out unconvertible never leaves an empty note behind" property, which threading a note path into the Rust conversion step would have regressed.

**Tech Stack:** Rust (`src-tauri/src/pdf/layout.rs`, `extract.rs`, `models.rs`; `src-tauri/src/commands/pdf.rs`), TypeScript/React (`src/pdf/types.ts`, `src/lib/tauri.ts`, `src/components/ImportButton.tsx`). No new Cargo or npm dependencies — `image` (already a dependency) handles PNG encoding; `pdfium-render`'s page-object API needs no new Cargo feature (`get_processed_bitmap` requires no `image_api` feature, confirmed against the vendored `pdfium-render 0.9.2` source).

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (per `CLAUDE.md`).
- `layout.rs` must stay free of any `pdfium` dependency — everything added to it in this plan is pure `CharBox`/`Line`/`Inline`/`Block` logic.
- `cargo clippy -- -D warnings` must pass clean before this is done.
- An image pdfium can't decode cleanly is skipped, never fatal to the rest of the page/document — same posture a malformed equation already gets.
- No size/type filtering — every embedded raster image is extracted (per the design spec's explicit choice).
- **Judge Rust-side work against the real document**: `notes/image_test.pdf` (generated via `.null/scratch/generate_image_test_pdf.py`) contains a gradient image between two paragraphs on page 0 and a standalone labeled figure after a heading on page 1. Task 7's verification is not optional.
- Small diffs, one concern per commit where the code allows it — but as with the table plan, adding a new `Inline`/`Block` variant forces every exhaustive match over those enums to compile *immediately*, including `blocks_to_markdown`'s rendering arm. Task 1 lands all of that together in one commit rather than pretending it can be deferred to a later task, a lesson carried over directly from executing the table plan.

---

## Background: what's missing today, confirmed against the real codebase (not assumptions)

`extract.rs`'s `extract_pages_native` calls `page.text()` and iterates `text.chars()` only. No code anywhere in this repository touches pdfium's page *object* API (`page.objects()`, `PdfPageObject`, `PdfPageImageObject`) — this is genuinely new ground, unlike the multi-column and table work, which layered pure `CharBox`-geometry logic on an already-existing extraction path.

Three things already exist and this plan reuses them rather than duplicating:

- **`src/editor/extensions/NoteImage.tsx`** already defines a working `image` TipTap node. `encodeSrc`/`decodeSrc` (thin `encodeURI`/`decodeURI` wrappers, exported from this file) exist specifically because a note's `.assets/` sidecar folder is named after the note and routinely contains spaces. It serializes to plain `![alt](src)` Markdown when no width/height is set — the exact syntax this plan's output uses, so it round-trips through the editor with zero frontend node changes.
- **`src-tauri/src/commands/assets.rs`**'s `write_note_asset(note_path, mime, data) -> Result<String, String>` already creates the note's `{stem}.assets/` sidecar and writes a file named `image-{unix_millis}.{ext}`, returning the relative path to embed. This plan does not touch this file at all — the frontend calls it exactly as `NoteImage.tsx`'s own `storeAndInsert` already does for pasted images.
- **`src/components/ImportButton.tsx`**'s `runImport` (read in full for this plan) calls `body = await api.pdf.importMarkdown(picked.path)` *before* `const note = await api.notes.create(...)`, with an explicit comment: *"Markdown mode converts before the note exists, so a PDF with nothing to convert — a scan, or a genuine failure — never leaves an empty note behind."* `create_note_file` (`src-tauri/src/commands/notes.rs`) derives the note's filename deterministically from its title via `note_filename` and **refuses** if a file of that name already exists (no silent `-1`-suffix collision handling) — so even if this plan wanted to predict the note's path before creation, there would be no safe way to guarantee it matches what `create_note` actually produces. Confirms the placeholder approach (no note path needed in the conversion step at all) is the only architecture that doesn't regress this property.

The exact pdfium-render API (confirmed by reading the vendored `pdfium-render-0.9.2` source directly, not just its docs, at `~/.cargo/registry/src/*/pdfium-render-0.9.2/src/pdf/document/page/object/image.rs` and `.../object.rs`):

- `page.objects().iter()` yields `PdfPageObject<'a>` values; `PdfPageObject::Image(PdfPageImageObject<'a>)` is one variant.
- `PdfPageObjectCommon::bounds(&self) -> Result<PdfQuadPoints, PdfiumError>` (blanket-implemented for every page object type; needs the trait imported to call as a method) gives `.left()`/`.bottom()`/`.right()`/`.top()`, each a `PdfPoints { pub value: f32 }` — the same shape `CharBox` extraction already reads off `ch.loose_bounds()`.
- `PdfPageImageObject::get_processed_bitmap(&self, document: &PdfDocument) -> Result<PdfBitmap, PdfiumError>` — accounts for filters/masks/transforms applied to the object, and (checked directly in the source) carries **no `#[cfg(feature = "image_api")]` gate**, unlike its `DynamicImage`-returning sibling `get_processed_image`. `PdfBitmap::as_rgba_bytes()` and `.width()`/`.height()` (returning `Pixels = i32`) are the exact same calls `renderer.rs`'s existing whole-page rasterization already uses — this plan's image-encoding code is a direct copy of that established pattern, avoiding pdfium-render's separately-versioned internal `image` dependency the same way `renderer.rs`'s own comment explains.
- `image::DynamicImage::write_to<W: Write + Seek, F: Into<ImageOutputFormat>>(&self, w: &mut W, format: F) -> ImageResult<()>` (confirmed against the vendored `image-0.24.9` source) with `image::ImageOutputFormat::Png` and a `std::io::Cursor<Vec<u8>>` target is how this plan gets in-memory PNG bytes rather than writing to a file path.

One risk found and designed around before it could become a repeat of the table work's `group_blocks` surprise: `group_blocks`'s `body_size_of` weights by `line.text().chars().filter(non-whitespace).count()`, and an image-only `Line`'s `.text()` is empty (confirmed: `Inline::ImageRef` contributes nothing to `Line::text()`, same as `Inline::TableRow` already doesn't) — so `body_size_of` already skips image lines via its existing `if count == 0 { continue; }` guard, no fix needed there. But `group_blocks`'s `left_margin = lines.iter().map(|l| l.x).fold(f32::INFINITY, f32::min)` is **not** guarded the same way — giving a synthetic image `Line` `x: 0.0` would collapse `left_margin` to 0.0 (or below any real body-text margin), silently inflating every list item's computed indent depth on any page containing an image. This plan's synthetic image `Line`s use the image's own real bounding-box `left`/`right` instead of a placeholder `0.0`, sidestepping this before it ships rather than finding it via a failing test later.

---

### Task 1: `Inline::ImageRef`, `Block::Image`, and every exhaustive match they touch

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Produces: `Inline::ImageRef(String, String)` (new enum variant — `placeholder`, `alt`), `Block::Image { placeholder: String, alt: String }` (new enum variant).
- Unlike `Inline::TableRow`, no boolean "starts a new group" flag is needed: an image never wraps or merges with a neighboring row the way a table row can, so every image-kind `Line` always opens its own block (see Task 2's `opens_block` change) — there is no "continuation" case to distinguish.

- [ ] **Step 1: Add the two new variants**

Find the `Inline` enum (already carries `Text`, `Maths`, `TableRow` from the table work):

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Inline {
    Text(Span),
    /// The LaTeX source, without delimiters. Text rather than an image so it can
    /// be copied into a prompt, searched, and edited in place.
    Maths(String),
    /// One table row's cells, each a `Vec<Inline>` in its own right so a cell
    /// can hold bold/italic spans or inline maths for free, plus whether this
    /// is the first row of its own detected table. `group_blocks` merges
    /// consecutive `TableRow`-only `Line`s into one `Block::Table`, using
    /// that flag — not a vertical-gap heuristic — to tell "this starts a new
    /// table" apart from "this continues the one before it": a wrapped
    /// cell's continuation line folds into its anchor row rather than
    /// becoming its own `Line` (see `reconstruct_tables`), so the gap to the
    /// *next* row is irregular by design, exactly the kind of row-height
    /// variation a gap-based heuristic would misread as a table boundary.
    TableRow(Vec<Vec<Inline>>, bool),
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
    /// can hold bold/italic spans or inline maths for free, plus whether this
    /// is the first row of its own detected table. `group_blocks` merges
    /// consecutive `TableRow`-only `Line`s into one `Block::Table`, using
    /// that flag — not a vertical-gap heuristic — to tell "this starts a new
    /// table" apart from "this continues the one before it": a wrapped
    /// cell's continuation line folds into its anchor row rather than
    /// becoming its own `Line` (see `reconstruct_tables`), so the gap to the
    /// *next* row is irregular by design, exactly the kind of row-height
    /// variation a gap-based heuristic would misread as a table boundary.
    TableRow(Vec<Vec<Inline>>, bool),
    /// A page image, referenced by a placeholder — not yet a real asset
    /// path. `import_pdf_markdown` (`commands/pdf.rs`) has no note to write
    /// a `.assets/` sidecar into at the point this Markdown is produced (see
    /// the design spec for why), so the actual file only exists once the
    /// frontend writes it and substitutes the placeholder for a real path.
    ImageRef(String, String),
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
                Inline::Maths(_) | Inline::TableRow(_, _) => None,
            })
            .collect()
    }

    pub(super) fn is_blank(&self) -> bool {
        // A table-row line carries no `Text`/`Maths` content of its own by
        // this measure (its content is nested one level deeper, inside each
        // cell), so without this check a real table row would be filtered
        // out as blank before `classify` ever saw it.
        self.text().trim().is_empty()
            && !self.content.iter().any(is_maths)
            && !matches!(self.content.as_slice(), [Inline::TableRow(_, _)])
    }
```

Replace with:

```rust
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter_map(|i| match i {
                Inline::Text(span) => Some(span.text.as_str()),
                Inline::Maths(_) | Inline::TableRow(_, _) | Inline::ImageRef(_, _) => None,
            })
            .collect()
    }

    pub(super) fn is_blank(&self) -> bool {
        // A table-row or image-ref line carries no `Text`/`Maths` content of
        // its own by this measure, so without this check either would be
        // filtered out as blank before `classify` ever saw it.
        self.text().trim().is_empty()
            && !self.content.iter().any(is_maths)
            && !matches!(self.content.as_slice(), [Inline::TableRow(_, _)])
            && !matches!(self.content.as_slice(), [Inline::ImageRef(_, _)])
    }
```

- [ ] **Step 3: Add `Block::Image`**

Find the `Block` enum's `Table` variant (the last one added by the table work):

```rust
    /// Every row's cells, first row always the header — a table with no
    /// natural header row is out of scope (see the design spec's
    /// Non-goals).
    Table { rows: Vec<Vec<Vec<Inline>>> },
}
```

Replace with:

```rust
    /// Every row's cells, first row always the header — a table with no
    /// natural header row is out of scope (see the design spec's
    /// Non-goals).
    Table { rows: Vec<Vec<Vec<Inline>>> },
    /// A single embedded image, referenced by placeholder — see
    /// `Inline::ImageRef`.
    Image { placeholder: String, alt: String },
}
```

- [ ] **Step 4: Fix the remaining five exhaustive matches over `Inline`**

None of these five call sites can ever actually receive an `Inline::ImageRef` at runtime — Task 2 makes `classify` divert every `ImageRef`-carrying `Line` to its own code path before any of these functions run on it — but, exactly as for `TableRow` in the table work, the match has to compile regardless.

In `reconstruct_fraction_sums`, find:

```rust
        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_, _) => false,
        });
```

Replace with:

```rust
        let is_display_maths = content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_, _) | Inline::ImageRef(_, _) => false,
        });
```

In `build_line`, find the **second** occurrence of that same shape (followed by `let right = row`, not `let (num_x0, num_x1)`):

```rust
    let is_display_maths = content.iter().any(is_maths)
        && content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_, _) => false,
        });
```

Replace with:

```rust
    let is_display_maths = content.iter().any(is_maths)
        && content.iter().all(|i| match i {
            Inline::Text(span) => span.text.trim().is_empty(),
            Inline::Maths(_) => true,
            Inline::TableRow(_, _) | Inline::ImageRef(_, _) => false,
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
                // Unreachable in practice: `classify` diverts a table-row
                // line before it ever reaches `join_lines` (only
                // Heading/List/Prose-kind lines do). Kept as a no-op rather
                // than a panic — see CLAUDE.md on trusting internal
                // invariants without crashing if one is ever violated.
                Inline::TableRow(_, _) => {}
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
                // Unreachable in practice: `classify` diverts a table-row or
                // image-ref line before either ever reaches `join_lines`
                // (only Heading/List/Prose-kind lines do). Kept as a no-op
                // rather than a panic — see CLAUDE.md on trusting internal
                // invariants without crashing if one is ever violated.
                Inline::TableRow(_, _) | Inline::ImageRef(_, _) => {}
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
                    Inline::Text(_) | Inline::TableRow(_, _) => None,
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
                    Inline::Text(_) | Inline::TableRow(_, _) | Inline::ImageRef(_, _) => None,
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
            // Unreachable: a cell's own content never nests another table
            // row, and `render_content` is never called on a `Block::Table`
            // directly (Task 5 renders each cell's `Vec<Inline>` through
            // this function instead).
            Inline::TableRow(_, _) => continue,
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
            // row or an image ref, and `render_content` is never called on
            // a `Block::Table`/`Block::Image` directly — each renders
            // through its own arm in `blocks_to_markdown` instead.
            Inline::TableRow(_, _) | Inline::ImageRef(_, _) => continue,
        };
```

In `combined_maths_latex`, find:

```rust
        .filter_map(|i| match i {
            Inline::Maths(s) => Some(s.as_str()),
            Inline::Text(_) | Inline::TableRow(_, _) => None,
        })
```

Replace with:

```rust
        .filter_map(|i| match i {
            Inline::Maths(s) => Some(s.as_str()),
            Inline::Text(_) | Inline::TableRow(_, _) | Inline::ImageRef(_, _) => None,
        })
```

- [ ] **Step 5: Add the rendering arm to `blocks_to_markdown` now — it is forced to compile, not deferred**

Find `blocks_to_markdown`'s `Block::Table` arm (the last one added by the table work):

```rust
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

Replace with:

```rust
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
            // The placeholder travels through verbatim — it isn't a real
            // path yet (see `Inline::ImageRef`), so there is nothing here
            // that needs the escaping a table cell's content does.
            Block::Image { placeholder, alt } => {
                parts.push(format!("![{alt}]({placeholder})"));
            }
        }
    }
```

- [ ] **Step 6: Write tests confirming the plumbing behaves correctly**

Add to `src-tauri/src/pdf/layout_tests.rs`:

```rust
fn image_ref_line(placeholder: &str, alt: &str, y: f32, left: f32, right: f32) -> Line {
    Line {
        content: vec![Inline::ImageRef(placeholder.to_string(), alt.to_string())],
        x: left,
        right,
        y,
        font_size: 0.0,
        fixed_pitch: false,
        is_display_maths: false,
        ends_hyphenated: false,
    }
}

#[test]
fn an_image_ref_line_is_not_blank() {
    assert!(!image_ref_line("pdf-image://0", "", 700.0, 72.0, 200.0).is_blank());
}

#[test]
fn an_image_ref_lines_own_text_is_empty() {
    assert_eq!(image_ref_line("pdf-image://0", "a figure", 700.0, 72.0, 200.0).text(), "");
}

#[test]
fn a_block_image_renders_as_a_markdown_image_reference() {
    let markdown = blocks_to_markdown(&[Block::Image {
        placeholder: "pdf-image://0".to_string(),
        alt: String::new(),
    }]);
    assert_eq!(markdown.trim_end(), "![](pdf-image://0)");
}
```

- [ ] **Step 7: Run tests to verify everything still passes**

Run (from `src-tauri/`): `cargo test --package null-notes layout_tests`
Expected: PASS — every existing test unchanged, plus the three new ones. Nothing yet constructs an `Inline::ImageRef` from real extraction, so this is otherwise behavior-neutral, exactly as Task 1 was for the table work.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): add ImageRef/Image data model and GFM-adjacent rendering for images"
```

---

### Task 2: `layout::ImageRef` and `chars_and_images_to_markdown` — reading-order interleaving

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
- Test: `src-tauri/src/pdf/layout_tests.rs`

**Interfaces:**
- Consumes: `group_lines`, `reconstruct_fractions`, `group_blocks`, `blocks_to_markdown` (all existing, unmodified), `LineKind`, `classify`, `Block` (Task 1).
- Produces: `pub struct ImageRef { pub placeholder: String, pub alt: String, pub left: f32, pub right: f32, pub y: f32 }`, `pub fn chars_and_images_to_markdown(chars: &[CharBox], images: &[ImageRef]) -> String` — used by `extract.rs` in Task 4. `chars_to_markdown` itself is untouched (still used directly by ~20 existing tests across `layout_tests.rs`/`columns_tests.rs`) — this is a new, sibling entry point, not a signature change.

- [ ] **Step 1: Add the `LineKind::Image` classification and `group_blocks` change**

Find `LineKind` (already carries `Table` from the table work):

```rust
enum LineKind {
    Prose,
    Code,
    Heading(u8),
    List(bool, usize),
    MathsDisplay,
    Table,
}
```

Replace with:

```rust
enum LineKind {
    Prose,
    Code,
    Heading(u8),
    List(bool, usize),
    MathsDisplay,
    Table,
    Image,
}
```

Find `classify`'s table check (near the top, checked before `is_display_maths`):

```rust
fn classify(line: &Line, body: f32, left_margin: f32) -> LineKind {
    // Checked before everything else, for the same reason as the
    // display-maths check just below: a table row's own font size or
    // leading whitespace could otherwise misread as a heading or list.
    if matches!(line.content.as_slice(), [Inline::TableRow(_, _)]) {
        return LineKind::Table;
    }
```

Replace with:

```rust
fn classify(line: &Line, body: f32, left_margin: f32) -> LineKind {
    // Checked before everything else, for the same reason as the
    // display-maths check just below: a table row's own font size or
    // leading whitespace could otherwise misread as a heading or list.
    if matches!(line.content.as_slice(), [Inline::TableRow(_, _)]) {
        return LineKind::Table;
    }
    if matches!(line.content.as_slice(), [Inline::ImageRef(_, _)]) {
        return LineKind::Image;
    }
```

Find `group_blocks`'s `opens_block` line:

```rust
        // A list marker always opens a new item, nothing accumulates onto a
        // heading, and a table row that starts a new table always opens its
        // own block — everything else only breaks when the kind changes.
        let opens_block = matches!(kind, LineKind::List(_, _))
            || matches!(current_kind, LineKind::Heading(_))
            || starts_new_table;
        let kind_break = opens_block || (kind != current_kind && !continues_item);
```

Replace with:

```rust
        // A list marker always opens a new item, nothing accumulates onto a
        // heading, a table row that starts a new table always opens its own
        // block, and every image always opens its own block too — an image
        // never merges with a neighbor the way a table row's continuation
        // can, so there is no equivalent "still the same one" flag to check.
        let opens_block = matches!(kind, LineKind::List(_, _))
            || matches!(current_kind, LineKind::Heading(_))
            || starts_new_table
            || kind == LineKind::Image;
        let kind_break = opens_block || (kind != current_kind && !continues_item);
```

Find `finish_block`'s `LineKind::Table` arm:

```rust
        LineKind::Table => Block::Table {
            rows: lines
                .iter()
                .filter_map(|l| match l.content.as_slice() {
                    [Inline::TableRow(cells, _)] => Some(cells.clone()),
                    _ => None,
                })
                .collect(),
        },
    }
}
```

Replace with:

```rust
        LineKind::Table => Block::Table {
            rows: lines
                .iter()
                .filter_map(|l| match l.content.as_slice() {
                    [Inline::TableRow(cells, _)] => Some(cells.clone()),
                    _ => None,
                })
                .collect(),
        },
        // `opens_block` guarantees exactly one line here whenever kind is
        // Image — every image-kind line forces its own block, never
        // accumulating with a neighbor.
        LineKind::Image => {
            let (placeholder, alt) = lines
                .first()
                .and_then(|l| match l.content.as_slice() {
                    [Inline::ImageRef(placeholder, alt)] => Some((placeholder.clone(), alt.clone())),
                    _ => None,
                })
                .unwrap_or_default();
            Block::Image { placeholder, alt }
        }
    }
}
```

- [ ] **Step 2: Write the failing tests**

Add to `layout_tests.rs`:

```rust
#[test]
fn an_image_lands_between_the_two_paragraphs_it_sits_between() {
    let mut chars = set("first paragraph text here", 72.0, 700.0, Style::default());
    chars.extend(set("second paragraph text here", 72.0, 640.0, Style::default()));

    let images = vec![ImageRef {
        placeholder: "pdf-image://0".to_string(),
        alt: String::new(),
        left: 72.0,
        right: 300.0,
        y: 670.0, // between the two paragraphs' y positions
    }];

    let markdown = chars_and_images_to_markdown(&chars, &images);
    let parts: Vec<&str> = markdown.trim_end().split("\n\n").collect();

    assert_eq!(parts.len(), 3, "got: {markdown}");
    assert_eq!(parts[0], "first paragraph text here");
    assert_eq!(parts[1], "![](pdf-image://0)");
    assert_eq!(parts[2], "second paragraph text here");
}

#[test]
fn two_images_never_merge_into_one_block() {
    let images = vec![
        ImageRef { placeholder: "pdf-image://0".to_string(), alt: String::new(), left: 72.0, right: 300.0, y: 700.0 },
        ImageRef { placeholder: "pdf-image://1".to_string(), alt: String::new(), left: 72.0, right: 300.0, y: 680.0 },
    ];

    let markdown = chars_and_images_to_markdown(&[], &images);

    assert_eq!(
        markdown.trim_end(),
        "![](pdf-image://0)\n\n![](pdf-image://1)"
    );
}

#[test]
fn no_images_behaves_exactly_like_chars_to_markdown() {
    let chars = set("ordinary text", 72.0, 700.0, Style::default());
    assert_eq!(chars_and_images_to_markdown(&chars, &[]), chars_to_markdown(&chars));
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --package null-notes layout_tests`
Expected: FAIL to compile — `ImageRef` (the struct) and `chars_and_images_to_markdown` don't exist yet.

- [ ] **Step 4: Implement**

Add to `src-tauri/src/pdf/layout.rs`, near `chars_to_markdown`:

```rust
/// One page image, ready to be interleaved into reading order. `left`/
/// `right`/`y` are in the same PDF user-space coordinates `CharBox` already
/// uses (bottom-left origin, larger `y` higher on the page) — `y` is the
/// image's own vertical center, since it has no baseline the way text does.
pub struct ImageRef {
    pub placeholder: String,
    pub alt: String,
    pub left: f32,
    pub right: f32,
    pub y: f32,
}

/// Like `chars_to_markdown`, but also places `images` into reading order.
/// Reuses the same pattern proven for tables, simpler here because an image
/// never wraps or merges with a neighbor: each becomes a synthetic `Line`
/// carrying a single `Inline::ImageRef`, appended to the `Line`s
/// `group_lines` already built from `chars` (which is untouched — no new
/// parameter, nothing about its own sort changes), then the combined list
/// is re-sorted by `y` before block grouping runs.
///
/// Each synthetic `Line` uses the image's own `left`/`right` for `x`/
/// `right` rather than a placeholder `0.0` — `group_blocks`'s own
/// `left_margin` computation folds `f32::min` over every line's `x`
/// (image lines included, since they are not blank), so a `0.0` here would
/// silently collapse the page's computed left margin and inflate every
/// list item's indent depth on any page containing an image.
pub fn chars_and_images_to_markdown(chars: &[CharBox], images: &[ImageRef]) -> String {
    let mut lines = group_lines(chars);
    lines.extend(images.iter().map(|img| Line {
        content: vec![Inline::ImageRef(img.placeholder.clone(), img.alt.clone())],
        x: img.left,
        right: img.right,
        y: img.y,
        font_size: 0.0,
        fixed_pitch: false,
        is_display_maths: false,
        ends_hyphenated: false,
    }));
    lines.sort_by(|a, b| b.y.partial_cmp(&a.y).unwrap_or(std::cmp::Ordering::Equal));
    blocks_to_markdown(&group_blocks(&reconstruct_fractions(lines)))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --package null-notes layout_tests`
Expected: PASS — all three new tests, plus everything from Task 1.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run (from `src-tauri/`): `cargo test --package null-notes`
Expected: PASS — every existing test, including the ~40 that call `group_lines`/`chars_to_markdown` directly and are untouched by this task.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): add chars_and_images_to_markdown for image reading-order interleaving"
```

---

### Task 3: `extract.rs` — pulling image bytes and bounds out of a PDF page

**Files:**
- Modify: `src-tauri/src/pdf/extract.rs`

**Interfaces:**
- Consumes: `pdfium_render::prelude::{PdfPageObject, PdfPageObjectCommon}` (new imports), `super::renderer::bind_pdfium` (existing).
- Produces: `pub struct ExtractedImage { pub data: Vec<u8>, pub left: f32, pub bottom: f32, pub right: f32, pub top: f32 }`, `ExtractedPage` gains a new `pub images: Vec<ExtractedImage>` field. Used by Task 4.
- This task is **not unit-testable without pdfium** (like the rest of `extract_pages_native`) — verified in Task 7 against the real document. Existing synthetic tests in this file must still compile and pass once updated for the new struct field (Step 3 below).

- [ ] **Step 1: Add `ExtractedImage` and extend `ExtractedPage`**

Find:

```rust
#[derive(Debug, Clone)]
pub struct ExtractedPage {
    pub index: usize,
    pub chars: Vec<CharBox>,
}
```

Replace with:

```rust
#[derive(Debug, Clone)]
pub struct ExtractedImage {
    /// PNG-encoded bytes, ready to write to disk as-is.
    pub data: Vec<u8>,
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
    pub top: f32,
}

#[derive(Debug, Clone)]
pub struct ExtractedPage {
    pub index: usize,
    pub chars: Vec<CharBox>,
    pub images: Vec<ExtractedImage>,
}
```

- [ ] **Step 2: Extract images in `extract_pages_native`**

Find the import line and the page-construction line:

```rust
#[cfg(feature = "pdf-native")]
fn extract_pages_native(pdf_path: &Path) -> Result<Vec<ExtractedPage>> {
    use pdfium_render::prelude::PdfFontWeight;

    let pdfium = super::renderer::bind_pdfium()?;
    let doc = pdfium.load_pdf_from_file(pdf_path, None)?;
    let mut pages = Vec::new();

    for (index, page) in doc.pages().iter().enumerate() {
        let text = page.text()?;
        let mut chars = Vec::new();
```

Replace with:

```rust
#[cfg(feature = "pdf-native")]
fn extract_pages_native(pdf_path: &Path) -> Result<Vec<ExtractedPage>> {
    use pdfium_render::prelude::{PdfFontWeight, PdfPageObject, PdfPageObjectCommon};

    let pdfium = super::renderer::bind_pdfium()?;
    let doc = pdfium.load_pdf_from_file(pdf_path, None)?;
    let mut pages = Vec::new();

    for (index, page) in doc.pages().iter().enumerate() {
        let text = page.text()?;
        let mut chars = Vec::new();
```

(No change inside the `for ch in text.chars().iter()` loop — leave every line of it exactly as it is.)

Find the page-push line:

```rust
        pages.push(ExtractedPage { index, chars });
    }

    Ok(pages)
}
```

Replace with:

```rust
        let mut images = Vec::new();
        for object in page.objects().iter() {
            let PdfPageObject::Image(image_object) = object else {
                continue;
            };
            if let Some(extracted) = extract_image(&image_object, &doc) {
                images.push(extracted);
            }
        }

        pages.push(ExtractedPage { index, chars, images });
    }

    Ok(pages)
}

/// Pulls one embedded raster image's bytes and page bounds out of an image
/// page object. `None` — never an error — when pdfium can't decode this
/// particular image: one bad embedded image must not fail the whole
/// document, the same posture a bad equation already gets (it renders its
/// own KaTeX error rather than breaking the page around it).
///
/// `get_processed_bitmap` (not `get_raw_bitmap`) so filters, masks, and
/// object transforms applied to the image are accounted for — the same
/// bitmap-to-PNG path `renderer.rs`'s whole-page rasterization already
/// uses, for the same reason its own comment gives: building the PNG
/// through this crate's own `image` dependency, rather than pdfium-render's
/// optional (and separately-versioned) `image_api` feature, sidesteps a
/// PNG encoder that isn't compiled in by default under that feature.
#[cfg(feature = "pdf-native")]
fn extract_image(
    image_object: &pdfium_render::prelude::PdfPageImageObject,
    doc: &pdfium_render::prelude::PdfDocument,
) -> Option<ExtractedImage> {
    let bounds = image_object.bounds().ok()?;
    let bitmap = image_object.get_processed_bitmap(doc).ok()?;
    let (width, height) = (bitmap.width() as u32, bitmap.height() as u32);
    let rgba = bitmap.as_rgba_bytes();
    let img = image::RgbaImage::from_raw(width, height, rgba)?;

    let mut data = Vec::new();
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut std::io::Cursor::new(&mut data), image::ImageOutputFormat::Png)
        .ok()?;

    Some(ExtractedImage {
        data,
        left: bounds.left().value,
        bottom: bounds.bottom().value,
        right: bounds.right().value,
        top: bounds.top().value,
    })
}
```

- [ ] **Step 3: Update the existing test helpers for the new `images` field**

Find (in this file's own `#[cfg(test)] mod tests`):

```rust
    fn page_of(text: &str) -> ExtractedPage {
        ExtractedPage {
            index: 0,
            chars: text
                .chars()
                .enumerate()
                .map(|(i, c)| char_at(c, 72.0 + i as f32 * 5.0, 700.0))
                .collect(),
        }
    }
```

Replace with:

```rust
    fn page_of(text: &str) -> ExtractedPage {
        ExtractedPage {
            index: 0,
            chars: text
                .chars()
                .enumerate()
                .map(|(i, c)| char_at(c, 72.0 + i as f32 * 5.0, 700.0))
                .collect(),
            images: Vec::new(),
        }
    }
```

Find the two other direct `ExtractedPage { ... }` constructions in this same test module (`a_page_with_almost_no_text_reads_as_empty` and `a_blank_page_does_not_leave_a_hole_in_the_document`):

```rust
        assert!(ExtractedPage { index: 0, chars: vec![] }.is_effectively_empty());
```

Replace with:

```rust
        assert!(ExtractedPage { index: 0, chars: vec![], images: Vec::new() }.is_effectively_empty());
```

```rust
            ExtractedPage { index: 1, chars: vec![] },
```

Replace with:

```rust
            ExtractedPage { index: 1, chars: vec![], images: Vec::new() },
```

(These three are the only direct `ExtractedPage { .. }` constructions outside `extract_pages_native` itself and Task 4's forthcoming changes — confirm with `grep -n "ExtractedPage {" src-tauri/src/pdf/extract.rs` that no others were missed before moving on.)

- [ ] **Step 4: Run the existing extract.rs tests to confirm they still compile and pass**

Run (from `src-tauri/`): `cargo test --package null-notes extract::tests`
Expected: PASS — same tests as before, updated only for the new field.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf/extract.rs
git commit -m "feat(pdf): extract embedded raster image bytes and bounds from page objects"
```

---

### Task 4: `pages_to_markdown` — region assignment, placeholder generation, and the new return shape

**Files:**
- Modify: `src-tauri/src/pdf/extract.rs`
- Modify: `src-tauri/src/pdf/models.rs`

**Interfaces:**
- Consumes: `columns::segment_regions` (existing), `layout::row_x_extent` (existing, already `pub(super)` and already used cross-module by `extract.rs` for the multi-column work), `layout::ImageRef`/`layout::chars_and_images_to_markdown` (Task 2), `ExtractedImage` (Task 3).
- Produces: `pdf::models::PendingImage { placeholder: String, mime: String, data: Vec<u8> }`, `pdf::models::PdfMarkdownImport { markdown: String, images: Vec<PendingImage> }` — both `Serialize`/`Deserialize` with `#[serde(rename_all = "camelCase")]`, matching `PdfPage`'s existing pattern in the same file. `pages_to_markdown` changes signature from `fn(&[ExtractedPage]) -> String` to `fn(&[ExtractedPage]) -> PdfMarkdownImport` — used by `commands/pdf.rs` in Task 5.

- [ ] **Step 1: Add the new model structs**

Find `src-tauri/src/pdf/models.rs` in full:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPage {
    pub index: usize,
    pub path: String,
    pub width: u32,
    pub height: u32,
}
```

Replace with:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPage {
    pub index: usize,
    pub path: String,
    pub width: u32,
    pub height: u32,
}

/// One image extracted from a Markdown-mode import, not yet written to
/// disk — `import_pdf_markdown` has no note to write a `.assets/` sidecar
/// into (see the design spec's Background), so the frontend writes this via
/// the existing `write_note_asset` and substitutes `placeholder` in the
/// returned Markdown for the real path it gets back.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingImage {
    pub placeholder: String,
    pub mime: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMarkdownImport {
    pub markdown: String,
    pub images: Vec<PendingImage>,
}
```

- [ ] **Step 2: Rewrite `pages_to_markdown`**

Find:

```rust
/// Renders every page's text layer to Markdown, one document.
pub fn pages_to_markdown(pages: &[ExtractedPage]) -> String {
    let mut chunks: Vec<String> = Vec::new();
    for page in pages {
        for region in columns::segment_regions(&page.chars) {
            let markdown = layout::chars_to_markdown(&region);
            if !markdown.trim().is_empty() {
                chunks.push(markdown.trim_end().to_string());
            }
        }
    }
    let mut out = chunks.join("\n\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
}
```

Replace with:

```rust
/// Renders every page's text layer, with images interleaved into reading
/// order, to Markdown, one document. Images are referenced by placeholder
/// — see `pdf::models::PendingImage`.
pub fn pages_to_markdown(pages: &[ExtractedPage]) -> models::PdfMarkdownImport {
    let mut chunks: Vec<String> = Vec::new();
    let mut pending: Vec<models::PendingImage> = Vec::new();
    let mut next_placeholder = 0usize;

    for page in pages {
        let regions = columns::segment_regions(&page.chars);

        if regions.is_empty() {
            // No text on this page at all. An ordinary blank page has no
            // images either and is skipped, unchanged from today — but a
            // page that is *entirely* one large figure (no text layer of
            // its own) still has images worth keeping rather than silently
            // losing an entire page's content.
            if page.images.is_empty() {
                continue;
            }
            let image_refs = take_images_as_refs(&page.images, &mut pending, &mut next_placeholder);
            let markdown = layout::chars_and_images_to_markdown(&[], &image_refs);
            if !markdown.trim().is_empty() {
                chunks.push(markdown.trim_end().to_string());
            }
            continue;
        }

        let region_bounds: Vec<(f32, f32)> =
            regions.iter().map(|r| layout::row_x_extent(r)).collect();
        let mut images_by_region: Vec<Vec<&ExtractedImage>> = vec![Vec::new(); regions.len()];
        for img in &page.images {
            let center_x = (img.left + img.right) / 2.0;
            if let Some((best_index, _)) = region_bounds
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    x_distance(center_x, a)
                        .partial_cmp(&x_distance(center_x, b))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
            {
                images_by_region[best_index].push(img);
            }
        }

        for (region, imgs) in regions.iter().zip(images_by_region) {
            let owned: Vec<ExtractedImage> = imgs.into_iter().cloned().collect();
            let image_refs = take_images_as_refs(&owned, &mut pending, &mut next_placeholder);
            let markdown = layout::chars_and_images_to_markdown(region, &image_refs);
            if !markdown.trim().is_empty() {
                chunks.push(markdown.trim_end().to_string());
            }
        }
    }

    let mut markdown = chunks.join("\n\n");
    if !markdown.is_empty() {
        markdown.push('\n');
    }
    models::PdfMarkdownImport { markdown, images: pending }
}

/// Distance from `x` to the nearest edge of `bounds` — `0.0` when `x` falls
/// inside it. Used to assign an image that doesn't cleanly land inside any
/// single multi-column region (e.g. one spanning a gutter) to whichever
/// region is closest, rather than dropping it.
fn x_distance(x: f32, bounds: &(f32, f32)) -> f32 {
    let (x0, x1) = *bounds;
    if x < x0 {
        x0 - x
    } else if x > x1 {
        x - x1
    } else {
        0.0
    }
}

/// Converts a page's raw extracted images into placeholder-tagged
/// `layout::ImageRef`s, pushing each one's bytes onto `pending` (the list
/// `pages_to_markdown` ultimately returns) as it goes.
fn take_images_as_refs(
    images: &[ExtractedImage],
    pending: &mut Vec<models::PendingImage>,
    next_placeholder: &mut usize,
) -> Vec<layout::ImageRef> {
    images
        .iter()
        .map(|img| {
            let placeholder = format!("pdf-image://{next_placeholder}");
            *next_placeholder += 1;
            pending.push(models::PendingImage {
                placeholder: placeholder.clone(),
                mime: "image/png".to_string(),
                data: img.data.clone(),
            });
            layout::ImageRef {
                placeholder,
                alt: String::new(),
                left: img.left,
                right: img.right,
                y: (img.top + img.bottom) / 2.0,
            }
        })
        .collect()
}
```

- [ ] **Step 3: Update existing tests for the new return shape**

Find (in this file's own test module):

```rust
    #[test]
    fn pages_are_concatenated_into_one_document() {
        let pages = vec![page_of("First page text here."), page_of("Second page text.")];

        let markdown = pages_to_markdown(&pages);

        assert_eq!(markdown, "First page text here.\n\nSecond page text.\n");
    }
```

Replace with:

```rust
    #[test]
    fn pages_are_concatenated_into_one_document() {
        let pages = vec![page_of("First page text here."), page_of("Second page text.")];

        let result = pages_to_markdown(&pages);

        assert_eq!(result.markdown, "First page text here.\n\nSecond page text.\n");
        assert!(result.images.is_empty());
    }
```

Find:

```rust
    #[test]
    fn a_blank_page_does_not_leave_a_hole_in_the_document() {
        let pages = vec![
            page_of("Real content."),
            ExtractedPage { index: 1, chars: vec![], images: Vec::new() },
            page_of("More content."),
        ];

        assert_eq!(pages_to_markdown(&pages), "Real content.\n\nMore content.\n");
    }
```

Replace with:

```rust
    #[test]
    fn a_blank_page_does_not_leave_a_hole_in_the_document() {
        let pages = vec![
            page_of("Real content."),
            ExtractedPage { index: 1, chars: vec![], images: Vec::new() },
            page_of("More content."),
        ];

        assert_eq!(pages_to_markdown(&pages).markdown, "Real content.\n\nMore content.\n");
    }
```

- [ ] **Step 4: Write new tests for image placement and the pending-images list**

Add to this same test module. These use `char_at`/`page_of` already defined here, plus a small local `ExtractedImage` builder:

```rust
    fn image_at(left: f32, bottom: f32, right: f32, top: f32) -> ExtractedImage {
        ExtractedImage { data: vec![1, 2, 3, 4], left, bottom, right, top }
    }

    #[test]
    fn an_extracted_image_becomes_a_placeholder_and_a_pending_entry() {
        let mut page = page_of("some text on the page");
        page.images.push(image_at(72.0, 690.0, 300.0, 710.0));

        let result = pages_to_markdown(&[page]);

        assert_eq!(result.images.len(), 1);
        assert_eq!(result.images[0].mime, "image/png");
        assert_eq!(result.images[0].data, vec![1, 2, 3, 4]);
        assert!(
            result.markdown.contains(&format!("![]({})", result.images[0].placeholder)),
            "got: {}",
            result.markdown
        );
    }

    #[test]
    fn a_page_that_is_only_an_image_still_keeps_it() {
        let mut page = ExtractedPage { index: 0, chars: vec![], images: Vec::new() };
        page.images.push(image_at(72.0, 690.0, 300.0, 710.0));

        let result = pages_to_markdown(&[page]);

        assert_eq!(result.images.len(), 1);
        assert!(result.markdown.contains("![]("), "got: {}", result.markdown);
    }

    #[test]
    fn a_page_with_no_text_and_no_images_produces_nothing() {
        let page = ExtractedPage { index: 0, chars: vec![], images: Vec::new() };
        let result = pages_to_markdown(&[page]);
        assert_eq!(result.markdown, "");
        assert!(result.images.is_empty());
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --package null-notes extract::tests`
Expected: PASS — all updated and new tests.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run (from `src-tauri/`): `cargo test --package null-notes`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pdf/extract.rs src-tauri/src/pdf/models.rs
git commit -m "feat(pdf): assign images to multi-column regions and return them as pending, placeholder-tagged data"
```

---

### Task 5: `commands/pdf.rs` — `import_pdf_markdown`'s new return type

**Files:**
- Modify: `src-tauri/src/commands/pdf.rs`

**Interfaces:**
- Consumes: `pdf::extract::pages_to_markdown` (Task 4, new return type), `pdf::models::PdfMarkdownImport` (Task 4).
- Produces: `import_pdf_markdown(pdf_path: String) -> Result<PdfMarkdownImport, String>` (same parameter, changed return type). Used by the frontend in Task 6.

- [ ] **Step 1: Update the command**

Find:

```rust
/// Converts a PDF's embedded text layer to Markdown. No OCR: a typeset sheet
/// already carries its own text, and reading it is exact where recognising
/// pixels would only ever be a guess.
///
/// Equations become LaTeX. The text layer holds no LaTeX, but it holds the font
/// each glyph came from and where it sits, which is enough to rebuild it — and
/// LaTeX, unlike a cropped image, can be copied into a prompt, searched, and
/// edited in place.
#[tauri::command]
pub async fn import_pdf_markdown(pdf_path: String) -> Result<String, String> {
    // pdfium is synchronous and a long sheet is real work, so it must not run
    // on the async executor.
    tokio::task::spawn_blocking(move || {
        let pages = crate::pdf::extract::extract_pages(Path::new(&pdf_path))
            .map_err(|e| e.to_string())?;

        if pages.iter().all(|page| page.is_effectively_empty()) {
            return Err(
                "This PDF has no text layer — it looks like a scan. Import it as pages instead."
                    .to_string(),
            );
        }

        Ok(crate::pdf::extract::pages_to_markdown(&pages))
    })
    .await
    .map_err(|e| e.to_string())?
}
```

Replace with:

```rust
/// Converts a PDF's embedded text layer to Markdown, with embedded raster
/// images extracted alongside it (placeholder-referenced — see
/// `pdf::models::PdfMarkdownImport`). No OCR: a typeset sheet already
/// carries its own text, and reading it is exact where recognising pixels
/// would only ever be a guess.
///
/// Equations become LaTeX. The text layer holds no LaTeX, but it holds the font
/// each glyph came from and where it sits, which is enough to rebuild it — and
/// LaTeX, unlike a cropped image, can be copied into a prompt, searched, and
/// edited in place.
///
/// Writes no files and takes no note path: this runs before the note it
/// will belong to exists (see `ImportButton.tsx`, which deliberately
/// converts before creating the note so a PDF that turns out unconvertible
/// never leaves an empty note behind). The caller writes each returned
/// image via the existing `write_note_asset` once the note's path is known,
/// substituting the real path for each placeholder.
#[tauri::command]
pub async fn import_pdf_markdown(pdf_path: String) -> Result<crate::pdf::models::PdfMarkdownImport, String> {
    // pdfium is synchronous and a long sheet is real work, so it must not run
    // on the async executor.
    tokio::task::spawn_blocking(move || {
        let pages = crate::pdf::extract::extract_pages(Path::new(&pdf_path))
            .map_err(|e| e.to_string())?;

        if pages.iter().all(|page| page.is_effectively_empty()) {
            return Err(
                "This PDF has no text layer — it looks like a scan. Import it as pages instead."
                    .to_string(),
            );
        }

        Ok(crate::pdf::extract::pages_to_markdown(&pages))
    })
    .await
    .map_err(|e| e.to_string())?
}
```

- [ ] **Step 2: Run the existing pdf.rs tests to confirm nothing else in this file references the old return type**

Run (from `src-tauri/`): `cargo test --package null-notes commands::pdf`
Expected: PASS — this file's own tests (`test_pdf_dir_for`, `test_ensure_pdf_dir_creates_directory`, `test_read_pdf_page_returns_base64`) don't touch `import_pdf_markdown` at all, so they're unaffected. Confirm this by reading the diff rather than assuming.

- [ ] **Step 3: Run the full Rust test suite and clippy**

Run: `cargo test --package null-notes && cargo clippy -- -D warnings`
Expected: both clean. `PdfMarkdownImport` needs `Serialize` for `#[tauri::command]`'s return type to compile at all (already added in Task 4) — if clippy or the build flags anything about the `Deserialize` derive being unused on a command-return-only type, that's expected and fine (Tauri command *parameters* need `Deserialize`, not returns — but `PdfMarkdownImport` is never a command parameter itself here, only the JSON shape a frontend hand-decodes; keep `Deserialize` anyway since `PendingImage`/`PdfMarkdownImport` may reasonably be constructed from JSON in tests later, matching `PdfPage`'s own existing `Serialize, Deserialize` pairing).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/pdf.rs
git commit -m "feat(pdf): return pending images alongside markdown from import_pdf_markdown"
```

---

### Task 6: Frontend — types, the `tauri.ts` wrapper, and `ImportButton.tsx`

**Files:**
- Modify: `src/pdf/types.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/components/ImportButton.tsx`
- Test: `src/components/ImportButton.test.ts`

**Interfaces:**
- Produces: `PendingImage`, `PdfMarkdownImport` TypeScript interfaces (`src/pdf/types.ts`), `api.pdf.importMarkdown` returning `Promise<PdfMarkdownImport>` instead of `Promise<string>`, `export function substituteImagePlaceholders(markdown: string, images: { placeholder: string; src: string }[]): string` (`ImportButton.tsx`) — a small pure function extracted specifically so this step is unit-testable, matching how `pagesToMarkdown` is already extracted and tested in this same file rather than left buried inside `runImport`.

- [ ] **Step 1: Add the new types**

Find `src/pdf/types.ts` in full:

```ts
export interface PdfPage {
  index: number
  path: string
  width: number
  height: number
}

export interface PdfImportProgress {
  page: number
  totalPages: number
}
```

Replace with:

```ts
export interface PdfPage {
  index: number
  path: string
  width: number
  height: number
}

export interface PdfImportProgress {
  page: number
  totalPages: number
}

// A page image extracted during Markdown-mode import, not yet written to
// disk — the caller writes it via api.assets.write once the note's path is
// known, then substitutes the real path for `placeholder` in the returned
// markdown. `data` is a plain byte array, the same shape api.assets.write
// already accepts.
export interface PendingImage {
  placeholder: string
  mime: string
  data: number[]
}

export interface PdfMarkdownImport {
  markdown: string
  images: PendingImage[]
}
```

- [ ] **Step 2: Update the `tauri.ts` wrapper**

Find:

```ts
    importMarkdown: (pdfPath: string) =>
      invoke<string>('import_pdf_markdown', { pdfPath }),
```

Replace with:

```ts
    importMarkdown: (pdfPath: string) =>
      invoke<PdfMarkdownImport>('import_pdf_markdown', { pdfPath }),
```

Find, near the top of `src/lib/tauri.ts`:

```ts
import type { PdfPage } from '../pdf/types'
```

Replace with:

```ts
import type { PdfPage, PdfMarkdownImport } from '../pdf/types'
```

- [ ] **Step 3: Write the failing test for `substituteImagePlaceholders`**

Add to `src/components/ImportButton.test.ts`:

```ts
import { substituteImagePlaceholders } from './ImportButton'

describe('substituteImagePlaceholders', () => {
  it('replaces each placeholder with its real path', () => {
    const markdown = 'before\n\n![](pdf-image://0)\n\nafter'
    const result = substituteImagePlaceholders(markdown, [
      { placeholder: 'pdf-image://0', src: 'Note.assets/image-1.png' },
    ])
    expect(result).toBe('before\n\n![](Note.assets/image-1.png)\n\nafter')
  })

  it('replaces multiple placeholders independently', () => {
    const markdown = '![](pdf-image://0)\n\n![](pdf-image://1)'
    const result = substituteImagePlaceholders(markdown, [
      { placeholder: 'pdf-image://0', src: 'a.png' },
      { placeholder: 'pdf-image://1', src: 'b.png' },
    ])
    expect(result).toBe('![](a.png)\n\n![](b.png)')
  })

  it('is a no-op when there are no images', () => {
    expect(substituteImagePlaceholders('plain text', [])).toBe('plain text')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run (from repo root): `npm test -- ImportButton`
Expected: FAIL — `substituteImagePlaceholders` doesn't exist yet.

- [ ] **Step 5: Implement `substituteImagePlaceholders` and wire it into `runImport`**

Find, near the top of `src/components/ImportButton.tsx`:

```ts
export function pagesToMarkdown(pages: PdfPage[]): string {
  return pages
    .map((p) => `\`\`\`pdf-page\n${JSON.stringify({ src: p.path, width: p.width, height: p.height })}\n\`\`\``)
    .join('\n\n')
}
```

Add directly after it:

```ts
// Each placeholder is generated by the backend as a unique token
// (pdf-image://N) that appears exactly once in the returned markdown, so a
// plain string replace per image is sufficient — no regex needed.
export function substituteImagePlaceholders(
  markdown: string,
  images: { placeholder: string; src: string }[],
): string {
  return images.reduce((text, img) => text.replace(img.placeholder, img.src), markdown)
}
```

Find `runImport`'s markdown-mode branch:

```ts
      let body: string | null = null
      if (mode === 'markdown') {
        setIsConverting(true)
        const convertible = await api.pdf.hasTextLayer(picked.path).finally(() => {
          setIsConverting(false)
        })
        if (!convertible) {
          setScanned(picked)
          return
        }
        setIsConverting(true)
        body = await api.pdf.importMarkdown(picked.path).finally(() => setIsConverting(false))
      }

      const folder = selectedFolder ?? workspacePath
      const note = await api.notes.create(workspacePath, folder, picked.title)

      const content =
        body !== null
          ? `# ${picked.title}\n\n${body}`
          : `# ${picked.title}\n\n${pagesToMarkdown(await importPages(picked.path, note.path))}\n`
```

Replace with:

```ts
      let body: string | null = null
      let pendingImages: PdfMarkdownImport['images'] = []
      if (mode === 'markdown') {
        setIsConverting(true)
        const convertible = await api.pdf.hasTextLayer(picked.path).finally(() => {
          setIsConverting(false)
        })
        if (!convertible) {
          setScanned(picked)
          return
        }
        setIsConverting(true)
        const result = await api.pdf.importMarkdown(picked.path).finally(() => setIsConverting(false))
        body = result.markdown
        pendingImages = result.images
      }

      const folder = selectedFolder ?? workspacePath
      const note = await api.notes.create(workspacePath, folder, picked.title)

      // Each pending image is written the same way a pasted image already
      // is (NoteImage.tsx's storeAndInsert), then its placeholder in the
      // markdown is swapped for the real, encodeSrc-encoded path — the
      // same encoding boundary the editor's own markdown round-trip uses.
      const writtenImages = await Promise.all(
        pendingImages.map(async (img) => ({
          placeholder: img.placeholder,
          src: encodeSrc(await api.assets.write(note.path, img.mime, img.data)),
        })),
      )
      const convertedBody = body !== null ? substituteImagePlaceholders(body, writtenImages) : null

      const content =
        convertedBody !== null
          ? `# ${picked.title}\n\n${convertedBody}`
          : `# ${picked.title}\n\n${pagesToMarkdown(await importPages(picked.path, note.path))}\n`
```

Find the import block at the top of `src/components/ImportButton.tsx`:

```ts
import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { usePdfImport } from '../pdf/usePdfImport'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore } from '../store/settings'
import { ImportModeDialog } from './ImportModeDialog'
import { api } from '../lib/tauri'
import type { PdfPage } from '../pdf/types'
import type { PdfImportMode } from '../types'
```

Replace with:

```ts
import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { usePdfImport } from '../pdf/usePdfImport'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore } from '../store/settings'
import { ImportModeDialog } from './ImportModeDialog'
import { api } from '../lib/tauri'
import { encodeSrc } from '../editor/extensions/NoteImage'
import type { PdfPage, PdfMarkdownImport } from '../pdf/types'
import type { PdfImportMode } from '../types'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- ImportButton`
Expected: PASS — all three new `substituteImagePlaceholders` tests, plus the existing `pagesToMarkdown` tests unchanged.

- [ ] **Step 7: Typecheck and run the full frontend test suite**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/pdf/types.ts src/lib/tauri.ts src/components/ImportButton.tsx src/components/ImportButton.test.ts
git commit -m "feat(pdf): write extracted images and substitute their real paths on Markdown-mode import"
```

---

### Task 7: Real-document verification and clippy

**Files:** none (verification only), plus a temporary diagnostic addition to `src-tauri/src/pdf/dump.rs` (removed again before the final commit, matching the precedent set during the table work's own Task 6 investigation).

- [ ] **Step 1: Run the existing markdown diagnostic against the real document**

From `src-tauri/`:

```bash
NULL_NOTES_PDF=../notes/image_test.pdf cargo test --package null-notes --features pdf-native dump_markdown -- --ignored --nocapture
```

`dump_markdown` (in `dump.rs`) currently calls `crate::pdf::layout::chars_to_markdown(&page.chars)` directly, bypassing `pages_to_markdown` and its image handling entirely — it will need a small, permanent update to call `crate::pdf::extract::pages_to_markdown(&pages)` and print `.markdown` (plus, for this diagnostic's purposes, a line per pending image showing its placeholder and byte count) instead. Make that update as part of this step, not as a throwaway — every other PDF-pipeline feature's real-document verification has run through this same diagnostic, and image extraction should too from now on.

Expected, checked by hand:
- Page 0: the gradient image's placeholder appears **between** the two paragraph blocks, not before or after both.
- Page 1: the standalone figure's placeholder appears after the "A Standalone Figure" heading and before the closing paragraph.
- Two pending images are reported in total, with non-trivial byte counts.

If the reading-order placement is wrong, do not force a fix by adjusting `chars_and_images_to_markdown`'s sort blindly — re-derive the actual `y` values pdfium reports for these two images (add a quick print of `bounds` inside `extract_image` temporarily) and treat a wrong order as a new root-cause investigation, per this pipeline's standing rule.

- [ ] **Step 2: Confirm the extracted image bytes are real, decodable PNGs of roughly the right size**

Add a temporary diagnostic to `src-tauri/src/pdf/dump.rs` (`#[test] #[ignore] fn dump_extracted_images`) that calls `extract::extract_pages`, and for each page's `images`, prints `image.data.len()` and decodes it back via `image::load_from_memory(&image.data)` to print the resulting width/height. Run it against `image_test.pdf` and confirm: two images total, decodable, with dimensions in the neighborhood of the known source sizes (300×200 for the gradient, 400×250 for the "Figure 1" solid-color image — exact pixel dimensions may differ slightly from the source PNGs depending on how pdfium re-samples an embedded image, so "in the neighborhood of" rather than an exact match is the right bar here). Remove this diagnostic once confirmed — it does not belong in the final commit, matching how the table work's own temporary `dump_table2_geometry`/`dump_unicode_table_stream_order` diagnostics were added, used, and then reverted out before that plan's Task 6 commit.

- [ ] **Step 3: Confirm the non-table, non-image worksheets are unaffected**

Run the same `dump_markdown` diagnostic against `notes/Analysis_1_Blatt2_2025.pdf` (or any other existing worksheet with no embedded images) and confirm its output is unchanged from before this plan — `pages_to_markdown`'s `images` list should come back empty, and its `markdown` field should be byte-identical to what `chars_to_markdown` alone already produced for these documents.

- [ ] **Step 4: Run clippy**

From `src-tauri/`: `cargo clippy -- -D warnings`
Expected: clean. Fix anything flagged in the new code before moving on.

- [ ] **Step 5: Commit any clippy fixups and the permanent `dump_markdown` update, separately from the temporary diagnostic removal**

```bash
git add src-tauri/src/pdf/dump.rs
git commit -m "feat(pdf): show extracted images in the dump_markdown diagnostic"
```

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/extract.rs src-tauri/src/commands/pdf.rs
git commit -m "fix(pdf): address clippy warnings in image extraction"
```

(Skip the second commit entirely if Step 4 was already clean.)

- [ ] **Step 6: Manual end-to-end check in the running app**

This plan's Rust-side verification (Steps 1-3) and the frontend unit test (Task 6, Step 6) each check their own layer in isolation, but neither actually exercises the full import flow end-to-end — that requires running the app. Per this project's own convention for UI-adjacent changes ("start the dev server and use the feature in a browser before reporting the task as complete"): run `npm run tauri dev`, use **Import PDF** on `notes/image_test.pdf` in Markdown mode, and confirm in the actual editor that both images render correctly, in the correct reading-order position, and that a `Note Title.assets/` folder was created next to the resulting note containing two PNG files. This step was not exercised while writing this plan (planning-only session, per explicit instruction) — treat it as a required, not optional, part of finishing this work.
