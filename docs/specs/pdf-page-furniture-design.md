# PDF page-number footer/header stripping

## Problem

`pages_to_markdown` (`extract.rs`) converts each PDF page's text layer through `layout::chars_and_images_to_markdown` and concatenates the results into one document. Nothing in that path recognizes a page number as page furniture rather than content — a bare footer digit or a "Seite N" running footer currently reconstructs as an ordinary line and can surface as a stray paragraph in the converted note.

The failure mode has already been hit twice, but only ever fixed *incidentally*: a page-footer page number coincidentally fell inside the row-search window `reconstruct_cases`/`reconstruct_matrices` use to find case/matrix content rows, corrupting an unrelated reconstruction. Both were patched by bounding the search window (`CASES_MAX_ROW_GAP`, `MATRIX_MAX_ROW_GAP`), not by recognizing the footer itself (see `layout.rs:2380`, `layout.rs:2829`, and the corresponding TODO.md P4-2c entries). This spec closes the general gap: recognize and drop page-number footers/headers before they reach the document at all.

## Design

### Where it plugs in

`layout.rs::group_lines` builds `rows: Vec<Vec<(usize, CharBox)>>` — one page-region's physical lines, top-to-bottom by `y` — and already runs a sequence of passes over that exact shape before the rows become `Line`s: `merge_extensible_rows`, `reconstruct_cases`, `reconstruct_matrices`, `reconstruct_fraction_sums`, `reconstruct_tables`. A new pass, `strip_page_furniture(rows: Vec<Vec<(usize, CharBox)>>) -> Vec<Vec<(usize, CharBox)>>`, joins that sequence right after `merge_extensible_rows` and before the rest:

```rust
merge_extensible_rows(&mut rows);
let rows = strip_page_furniture(rows);
let (mut lines, rows) = reconstruct_cases(rows);
// ...unchanged from here
```

Running per-region (not once per page, before column splitting) matches how every other structural pass here already works, and needs no page-height/pdfium input — `layout.rs` must stay pdfium-free (CLAUDE.md).

### Detection

Only the topmost and bottommost row of a region are ever candidates — page furniture is always the outermost row. Each is dropped only if **both** hold:

1. **Pattern match.** The row's full text — its characters sorted by `x` and trimmed — matches one of a fixed, case-insensitive set of page-number shapes:
   - a bare number: `3`
   - a dashed number: `- 3 -` (also em/en dash)
   - `Seite`/`Page`/`S.`/`p.` optionally followed by a number and an optional total: `Seite 4`, `Page 3 of 10`, `S. 4`, `Seite 3 von 10`
   - a number/total pair: `3/10`, `3 von 10`, `3 of 10`

   Matching is hand-written, following the file's existing style (`list_marker`, `is_cases_brace`) — no `regex` dependency added to this module.

2. **Isolation.** The vertical gap between the candidate row and its inward neighbor exceeds `dominant_font_size(chars) * PAGE_FURNITURE_MIN_GAP`, a new constant defined the same way `MATRIX_MAX_ROW_GAP`/`CASES_MAX_ROW_GAP` already express "gap relative to glyph size." A region with fewer than 2 rows has no neighbor to be isolated from and is left untouched — a page that is *only* a footer never reaches this code anyway, since `ExtractedPage::is_effectively_empty` (20-char floor) already excludes it upstream.

Both checks exist to keep this conservative: pattern match alone would risk a real short line ("42." as a genuine answer, though that fails the marker shape anyway since `list_marker` requires trailing content on the same row) or a numbered exercise heading; isolation alone would risk stripping a genuinely short final paragraph. Requiring both keeps false positives to the same shape as the two bugs that motivated this — an outermost row, clearly detached, that reads as nothing but a page number.

### Non-goals

Per the earlier scoping decision: no running-header/title detection (a repeated course name or chapter title printed on every page), no cross-page comparison. This pass only recognizes an isolated, pattern-matching numeric line — the same shape the two existing incidental bugs already hit, handled generally instead of by accident.

### Testing

Unit tests added to `layout_tests.rs`, following its existing `chars_to_markdown`-driven pattern (synthetic `CharBox` pages, no pdfium):

- A bare-number footer, isolated below body text, is stripped.
- A `Seite N` / `Page N of M` footer, isolated, is stripped.
- A short body line that is *not* isolated (normal line spacing to its neighbor) is kept, proving isolation alone doesn't trigger removal.
- A numbered list item (`1. Aufgabe`) at the top or bottom of a region is kept, proving the pattern match requires the *entire* row to be nothing but the page-number shape.
- A region with only one row is left untouched.

## Out of scope

- Running headers/footers that repeat text (course name, chapter title) across pages — no cross-page comparison exists in this pipeline today, and adding one is a larger change than this fix.
- Multi-column pages where a footer spans multiple column regions — each region is checked independently; a footer that lands entirely inside one region's `x`-range (the common case for this corpus's single-column documents) is handled, a footer straddling two regions is not.
