# PDF page-number footer/header stripping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Recognize an isolated page-number footer/header (a bare digit, "Seite 4", "Page 3 of 10", "- 3 -") on a PDF page and drop it during Markdown conversion, instead of letting it reconstruct as a stray line of body content.

**Architecture:** A new pass, `strip_page_furniture`, joins the existing sequence of row-level reconstruction passes inside `layout.rs::group_lines` (`merge_extensible_rows` → `reconstruct_cases` → `reconstruct_matrices` → `reconstruct_fraction_sums` → `reconstruct_tables`). It inspects only the topmost and bottommost row of a page region and drops a row only when its rendered text matches a fixed page-number shape *and* it sits a clear vertical gap away from its neighboring row.

**Tech Stack:** Rust, no new dependencies (hand-written pattern matching, following the file's existing `list_marker`/`is_cases_brace` style — no `regex`).

## Global Constraints

- `pdf/layout.rs` must stay free of any `pdfium` dependency — it takes plain `CharBox` values only (see `CLAUDE.md`, "The PDF pipeline").
- No `.unwrap()`/`.expect()` outside tests (`CLAUDE.md`, "Error handling").
- `cargo clippy -- -D warnings` must pass clean before this is done.
- Tests are unit tests in `src-tauri/src/pdf/layout_tests.rs`, driven through `chars_to_markdown` on synthetic `CharBox` pages — no pdfium needed, matching every other test in that file.

---

## Task 1: Recognize a page-number shape from a row's rendered text

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` (new private function, placed directly above `merge_extensible_rows` at line 1081 — i.e. immediately after `group_lines` ends at line 1072)
- Test: `src-tauri/src/pdf/layout_tests.rs` (indirectly, via Task 2's integration tests — this task has no directly-callable public surface, matching how `list_marker` is only tested through the full pipeline, not in isolation)

**Interfaces:**
- Consumes: nothing new.
- Produces: `fn looks_like_page_number(text: &str) -> bool`, used by Task 2.

- [ ] **Step 1: Add `looks_like_page_number` and its small helpers**

Insert this block in `src-tauri/src/pdf/layout.rs`, directly before the existing `fn merge_extensible_rows` (currently at line 1081, right after `group_lines` closes at line 1072):

```rust
/// Recognizes a row's full rendered text as nothing but a page-number
/// shape: a bare number ("3"), a dashed number ("- 3 -"), a labelled
/// number ("Seite 4", "Page 3", "S. 4", "p. 4"), a number/total pair
/// ("3/10", "3 von 10", "3 of 10"), or a labelled pair ("Seite 3 von 10",
/// "Page 3 of 10"). Deliberately hand-written, not `regex` — this file
/// stays free of it, following `list_marker`/`is_cases_brace`'s existing
/// style of small manual parsers for a fixed set of shapes.
///
/// Whole-row match only: "1. Aufgabe" fails this (its own trailing content
/// after the number rules it out) the same way a genuine page number never
/// carries a trailing word — this is what keeps a numbered list item or
/// exercise heading from ever being mistaken for a footer.
fn looks_like_page_number(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() {
        return false;
    }

    if let Some(inner) = strip_dashes(text) {
        return is_bare_number(inner.trim());
    }

    let tokens: Vec<&str> = text.split_whitespace().collect();
    match tokens.as_slice() {
        [only] => is_bare_number(only) || is_number_pair_no_space(only),
        [prefix, number] if is_page_word(prefix) => is_bare_number(number),
        [number, sep, total] => is_bare_number(number) && is_pair_separator(sep) && is_bare_number(total),
        [prefix, number, sep, total] => {
            is_page_word(prefix) && is_bare_number(number) && is_pair_separator(sep) && is_bare_number(total)
        }
        _ => false,
    }
}

/// "- 3 -" / "– 3 –" / "— 3 —" — the leading and trailing character must
/// both be a dash variant, with something between them, or a genuine
/// hyphenated word or a maths minus sign would match on either end alone.
fn strip_dashes(text: &str) -> Option<&str> {
    const DASHES: [char; 3] = ['-', '\u{2013}', '\u{2014}'];
    let first = text.chars().next()?;
    let last = text.chars().last()?;
    if text.chars().count() > 2 && DASHES.contains(&first) && DASHES.contains(&last) {
        Some(&text[first.len_utf8()..text.len() - last.len_utf8()])
    } else {
        None
    }
}

/// A page number is never more than 4 digits (this app's PDFs are lecture
/// sheets, not book-length documents) — bounding the length keeps a stray
/// long numeral (a formula's constant, a year in prose) from ever reading
/// as a page number on digit-shape alone.
fn is_bare_number(s: &str) -> bool {
    !s.is_empty() && s.len() <= 4 && s.chars().all(|c| c.is_ascii_digit())
}

/// "3/10" as a single token (no spaces around the slash).
fn is_number_pair_no_space(s: &str) -> bool {
    match s.split_once('/') {
        Some((a, b)) => is_bare_number(a) && is_bare_number(b),
        None => false,
    }
}

fn is_page_word(s: &str) -> bool {
    matches!(s.to_lowercase().trim_end_matches('.'), "seite" | "page" | "s" | "p")
}

fn is_pair_separator(s: &str) -> bool {
    matches!(s.to_lowercase().as_str(), "von" | "of" | "/")
}
```

- [ ] **Step 2: Compile-check**

Run: `cargo check -p null-notes` (or the workspace's crate name — check `src-tauri/Cargo.toml`'s `[package] name` if unsure) from `src-tauri/`.
Expected: compiles clean. `looks_like_page_number` and its helpers are unused at this point, so expect `warning: function is never used` — that's fine, Task 2 wires it in next. Do not add `#[allow(dead_code)]`; it disappears once Task 2 lands.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/pdf/layout.rs
git commit -m "feat(pdf): recognize page-number footer/header text shapes"
```

---

## Task 2: Strip an isolated page-number row from `group_lines`

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs`
  - New constant near the other gap-ratio constants (after `TABLE_MATHS_GUARD_RATIO` at line 272)
  - New function `strip_page_furniture`, placed directly above `merge_extensible_rows` (i.e. above the block Task 1 added, so the new code reads top-to-bottom: constant → `strip_page_furniture` → `looks_like_page_number` and its helpers → `merge_extensible_rows`)
  - One-line wiring change inside `group_lines`, between line 1061 (`merge_extensible_rows(&mut rows);`) and line 1062 (`let (mut lines, rows) = reconstruct_cases(rows);`)
- Test: `src-tauri/src/pdf/layout_tests.rs` (new tests appended at the end of the file, after `no_images_behaves_exactly_like_chars_to_markdown` at line 2080)

**Interfaces:**
- Consumes: `looks_like_page_number(text: &str) -> bool` (Task 1); existing `row_y(row: &[CharBox]) -> f32`, `row_font_size(row: &[CharBox]) -> f32` (both already `pub(super)`, defined at lines 398 and 404); existing `build_line(row: Vec<(usize, CharBox)>) -> Line` (private, line 1169); existing `render_content(content: &[Inline]) -> String` (private, line 2648).
- Produces: `fn strip_page_furniture(rows: Vec<Vec<(usize, CharBox)>>) -> Vec<Vec<(usize, CharBox)>>`, called once from `group_lines`. No other task depends on this directly — it's the terminal piece of this plan.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/pdf/layout_tests.rs`, after the last test (`no_images_behaves_exactly_like_chars_to_markdown`, ending at line 2083):

```rust

#[test]
fn strips_an_isolated_bare_number_footer() {
    let mut chars = page(&["Body text on the page."]);
    // 40pt below the body line (10pt font * 3.0 gap ratio = 30pt threshold).
    chars.extend(set("3", 72.0, 700.0 - 12.0 - 40.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "Body text on the page.\n");
}

#[test]
fn strips_an_isolated_labelled_footer() {
    let mut chars = page(&["Body text on the page."]);
    chars.extend(set("Page 3 of 10", 72.0, 700.0 - 12.0 - 40.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "Body text on the page.\n");
}

#[test]
fn a_number_at_normal_line_spacing_is_kept() {
    // "3" sits right below its paragraph at ordinary line spacing (12pt),
    // well under the isolation threshold — it reads as real content (e.g.
    // the last line of a short answer), not a footer.
    let chars = page(&["The answer is:", "3"]);

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains('3'), "markdown was: {markdown:?}");
}

#[test]
fn a_numbered_list_item_is_never_mistaken_for_a_page_number() {
    let mut chars = page(&["Body paragraph here."]);
    chars.extend(set("1. Aufgabe", 72.0, 700.0 - 12.0 - 40.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("Aufgabe"), "markdown was: {markdown:?}");
}

#[test]
fn a_single_row_page_is_left_untouched() {
    let chars = set("3", 72.0, 700.0, Style::default());

    let markdown = chars_to_markdown(&chars);

    assert_eq!(markdown, "3\n");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p null-notes --lib pdf::layout_tests -- page_number` (adjust the crate name per `src-tauri/Cargo.toml` if `null-notes` isn't it) from `src-tauri/`.
Expected: `strips_an_isolated_bare_number_footer` and `strips_an_isolated_labelled_footer` FAIL (the footer text is still present in the output markdown, since nothing strips it yet). The other three tests pass already since nothing in this plan changes their behavior yet — that's expected; they're written now as regression guards for Step 3.

- [ ] **Step 3: Add the constant and `strip_page_furniture`, and wire it into `group_lines`**

In `src-tauri/src/pdf/layout.rs`, add this constant right after `TABLE_MATHS_GUARD_RATIO` (line 272):

```rust
// A vertical gap this many times a row's own font size marks it as
// detached from its neighbor — clearly more than an ordinary paragraph
// break (`BLOCK_GAP_RATIO`, 1.5x), the way a page's margin always is.
const PAGE_FURNITURE_MIN_GAP: f32 = 3.0;
```

Add `strip_page_furniture` directly above `fn merge_extensible_rows` (currently line 1081), i.e. immediately above the block Task 1 added:

```rust
/// Drops an isolated page-number footer/header — see
/// `looks_like_page_number` — from a page region's outermost row(s).
///
/// Only the topmost and bottommost row are ever candidates: page
/// furniture is always the outermost content on the page. A region with
/// fewer than two rows has no neighbor to be isolated from and is left
/// untouched entirely — and in practice never reaches this code anyway,
/// since a page whose only content is a footer fails
/// `ExtractedPage::is_effectively_empty`'s character-count floor upstream.
///
/// Runs before every other row-level reconstruction pass in `group_lines`
/// (`reconstruct_cases`, `reconstruct_matrices`, ...) so a page-footer
/// digit is gone before it can coincidentally land inside one of their own
/// row searches — the exact failure `CASES_MAX_ROW_GAP`/
/// `MATRIX_MAX_ROW_GAP` had to be added to guard against (see their
/// comments): this removes the footer itself instead of only bounding its
/// blast radius.
fn strip_page_furniture(rows: Vec<Vec<(usize, CharBox)>>) -> Vec<Vec<(usize, CharBox)>> {
    if rows.len() < 2 {
        return rows;
    }

    let mut start = 0;
    let mut end = rows.len();

    if is_isolated_page_number(&rows[0], &rows[1]) {
        start = 1;
    }
    if end - start >= 2 && is_isolated_page_number(&rows[end - 1], &rows[end - 2]) {
        end -= 1;
    }

    rows[start..end].to_vec()
}

/// Whether `row` is both a recognized page-number shape and detached from
/// `neighbor` by more than `PAGE_FURNITURE_MIN_GAP` times its own font
/// size. Rendered through `build_line`/`render_content` — the same space-
/// synthesis and text assembly every ordinary line already goes through —
/// rather than a second, ad-hoc text-extraction routine.
fn is_isolated_page_number(row: &[(usize, CharBox)], neighbor: &[(usize, CharBox)]) -> bool {
    let plain: Vec<CharBox> = row.iter().map(|(_, c)| *c).collect();
    let text = render_content(&build_line(row.to_vec()).content);
    if !looks_like_page_number(text.trim()) {
        return false;
    }

    let neighbor_plain: Vec<CharBox> = neighbor.iter().map(|(_, c)| *c).collect();
    let size = row_font_size(&plain).max(1.0);
    (row_y(&plain) - row_y(&neighbor_plain)).abs() > size * PAGE_FURNITURE_MIN_GAP
}
```

Then wire it into `group_lines` — change lines 1061-1062 from:

```rust
    merge_extensible_rows(&mut rows);
    let (mut lines, rows) = reconstruct_cases(rows);
```

to:

```rust
    merge_extensible_rows(&mut rows);
    let rows = strip_page_furniture(rows);
    let (mut lines, rows) = reconstruct_cases(rows);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p null-notes --lib pdf::layout_tests -- page_number` from `src-tauri/`.
Expected: all five new tests PASS.

- [ ] **Step 5: Run the full layout test suite**

Run: `cargo test -p null-notes --lib pdf::layout_tests` from `src-tauri/`.
Expected: PASS — no regressions in the existing suite (in particular, no test whose fixture happens to end or begin with an isolated bare-number-shaped row should have been relying on it surviving; if one does fail, inspect it before changing this task's logic, since a real regression here means a genuine document fixture was depending on undetected footer text).

- [ ] **Step 6: `cargo clippy`**

Run: `cargo clippy -p null-notes -- -D warnings` from `src-tauri/`.
Expected: clean, no warnings (confirms Task 1's dead-code warning is gone now that Task 2 calls `looks_like_page_number`).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "feat(pdf): strip isolated page-number footers/headers from converted notes"
```

---

## Task 3: Record the fix in `TODO.md`

**Files:**
- Modify: `TODO.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (documentation only).

- [ ] **Step 1: Add an entry under the P4-2c section**

`TODO.md`'s P4-2c section (the "Third through sixth real-document pass" entry) already documents both prior incidental page-footer encounters (the `CASES_MAX_ROW_GAP` and `MATRIX_MAX_ROW_GAP` bugs). Add a new bullet to that section — following the file's existing bold-lead-sentence style — recording that the general case is now handled:

```markdown
- [x] **A page-footer page number could still leak into the converted note as a stray line, outside the two incidental cases already caught above.** Both prior fixes only bounded a page number's *blast radius* on an unrelated reconstruction pass (`CASES_MAX_ROW_GAP`, `MATRIX_MAX_ROW_GAP`); neither removed the footer itself. `group_lines` now runs `strip_page_furniture` before any other row-level pass, dropping an isolated, pattern-matching page number/header (bare digit, "Seite N", "Page N of M", "- N -") from a region's topmost or bottommost row before it can become body content at all. See `docs/specs/pdf-page-furniture-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs(pdf): record page-furniture stripping in TODO.md"
```

---

## Self-Review Notes

- **Spec coverage:** "Where it plugs in" → Task 2 Step 3's wiring change. "Detection" pattern list → Task 1's `looks_like_page_number` covers every shape named in the spec (bare number, dashed number, `Seite`/`Page`/`S.`/`p.` prefix with optional total, number/total pair). "Isolation" → `is_isolated_page_number`'s gap check against `PAGE_FURNITURE_MIN_GAP`. "Non-goals" → no cross-page or running-header logic was added anywhere in this plan. "Testing" → all five cases from the spec's test list are present in Task 2 Step 1 (bare-number footer, labelled footer, non-isolated number kept, numbered list item kept, single-row region untouched).
- **Type consistency:** `strip_page_furniture` and `is_isolated_page_number` both use `Vec<(usize, CharBox)>` / `&[(usize, CharBox)]`, matching `reconstruct_cases`/`reconstruct_matrices`'s existing row shape exactly. `looks_like_page_number(text: &str) -> bool` is called with `text.trim()` in `is_isolated_page_number`, matching its signature.
- **No placeholders:** every step has complete code, no TODOs.
