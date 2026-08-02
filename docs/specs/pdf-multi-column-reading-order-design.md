# PDF Multi-Column Reading Order Design

**Goal:** Read multi-column PDFs (two-column papers/handouts, and pages that mix a full-width header/section with a multi-column body) in correct human reading order — top-to-bottom within a column, left column before right — instead of the current behavior, which sorts every character on the page by `y` then `x` with no notion of columns at all, interleaving left- and right-column text onto the same reconstructed line.

**Why now:** This is the first of a four-part effort to bring the PDF pipeline closer to what a well-built PDF-to-notes import should do (matching the general quality bar of e.g. Notion's PDF import, which this work was prompted by comparing against). Structure detection, tables, and images are the other three parts; each is an independent subsystem with no shared code with this one or with each other, so they are scoped as separate specs. Multi-column reading order goes first because it's foundational — tables and images will inherit whatever reading order this pass establishes, so getting it right first avoids rework in the other two.

**Non-goals (out of scope for this spec):**
- Tables, images/figures, and general structure-detection improvements — separate specs.
- Asymmetric-width columns (e.g. a narrow sidebar beside a wide body). The detection heuristic below requires a band's columns to be similar-width; unequal-width layouts are a guess without a real document to validate against, and are deliberately deferred.
- More than 3 columns in a single band (not a shape course material takes).
- Column detection across a page boundary — reading order still resets at each page, as it does today.

---

## Background: current behavior

`pdf::layout::group_lines` (`src-tauri/src/pdf/layout.rs:537`) takes a page's entire `Vec<CharBox>`, sorts it purely by `y` (descending) then `x`, and groups characters into rows by baseline tolerance. There is no concept of a column: on a two-column page, left- and right-column characters at the same vertical position land in the same baseline-tolerance window and get merged into one garbled row. `extract.rs` confirms there's no column-awareness anywhere upstream either — it only produces flat `CharBox` streams per page.

## Architecture

A new module, `src-tauri/src/pdf/columns.rs`, sitting alongside `layout.rs`. Like `layout.rs`, it is pure `CharBox` geometry — no pdfium dependency, fully unit-testable without the native library, consistent with the project's existing constraint that judgment lives in geometry-only modules.

One entry point:

```rust
pub fn segment_regions(chars: &[CharBox]) -> Vec<Vec<CharBox>>
```

Called once per page, before the existing layout pipeline:

```rust
// extract.rs, pages_to_markdown
for page in pages {
    for region in columns::segment_regions(&page.chars) {
        // existing: layout::chars_to_markdown(&region)
    }
}
```

Each region is a `Vec<CharBox>` in the exact shape `layout::chars_to_markdown` already accepts. Regions are handed to the **existing, unmodified** `group_lines` → `reconstruct_fractions` → `group_blocks` pipeline independently, and their rendered Markdown is concatenated in the order `segment_regions` returned them — the same join `pages_to_markdown` already does between pages.

This keeps blast radius small: zero changes to equation/fraction reconstruction, list detection, or any other part of `layout.rs`. A single-column page (the common case today) must produce exactly one region — the whole page, characters in original order — making today's behavior a provable special case of the new code path rather than a separately-maintained fallback.

## Detection heuristics

Both passes work off one shared measurement, computed over a group of rows: is their horizontal extent **full-width** (spans most of the page's content width) or **column-width** (clusters into one of ~N roughly-equal horizontal slices)?

Rows themselves are approximated by a small helper local to `columns.rs` — sort by `y` then group by baseline tolerance, the same idea `group_lines`'s first pass already uses. This is intentionally a simpler, separate implementation rather than a shared extraction from `layout.rs`: `columns.rs`'s rows only need to be good enough to measure geometry for cut decisions, not to correctly attach superscripts/exponents to their base row the way `group_lines`'s real row-building does. Duplicating a few lines of baseline-tolerance grouping is preferable to coupling the two modules' internals together for a purpose neither fully shares.

**Column split** (within a band): find the strongest vertical gutter — an x-range no character crosses, spanning most of the band's height, crossed by several distinct row baselines on both sides. The multi-row-crossing requirement is the guard that stops a stacked fraction's numerator/denominator gap (2-3 rows tall at most) from ever being mistaken for a column boundary — a real column gutter is crossed by many more rows than that. If a strong-enough gutter splits the band into two similar-width, similar-content halves, cut there and recurse into each half, capped at 3 columns (mirrors `split_into_terms`'s existing "the gap chosen must be markedly wider than the next-widest gap, or it's a guess" rule, applied to whole rows instead of characters within one row).

**Band split** (whole page, top-to-bottom): walk the page's rows looking for a horizontal gap where the row pattern changes character — a run of full-width rows giving way to a run of column-width rows, or vice versa. An ordinary paragraph gap *inside* one column never changes that pattern, so it is left alone for `group_blocks`'s existing paragraph-break logic to handle, exactly as today. Only a genuine structural change (header above a multi-column body, or the reverse) produces a band boundary.

Regions come out of the recursion already in reading order — bands top-to-bottom, columns left-to-right within a band — because that is the order the recursion visits them in; no separate sort step is needed.

Exact numeric thresholds (minimum gutter width in ems, minimum crossing-row count, width-similarity tolerance for "similar halves") are implementation-time constants, tuned the same way `FRACTION_MAX_ROW_GAP`/`FRACTION_MIN_OVERLAP_RATIO` were: starting values chosen to satisfy the synthetic test fixtures below, with the explicit expectation (see Testing) that they may need revisiting once checked against a real document.

## Design principle: bias toward under-detection

False-positive column/band detection on an ordinary single-column document — the overwhelming majority of real usage today — would corrupt reading order for content that already works correctly. Every threshold in this design is deliberately conservative: when detection is ambiguous, `segment_regions` falls back to returning the whole page as one region (today's behavior) rather than guessing at a cut. Under-detecting a genuine multi-column page produces the current garbled-but-familiar failure mode; over-detecting on a single-column page would be a regression. The asymmetry between those two failure costs is why the bias points this way.

## Edge cases

- **Single-column pages** produce exactly one region, unchanged — the primary regression guard for this whole feature.
- **A centered display equation** with wide margins on both sides is not a column gutter: it's 1-3 rows tall, and the crossing-row-count guard requires many rows on both sides of a candidate gutter before it counts as a real column.
- **Unequal-width columns** (sidebar + body) are out of scope, per Non-goals above — the "similar-width halves" requirement in the column-split rule won't catch them, and that's intentional rather than an oversight.
- **Uneven column length** (one column ends a few lines before the other, common at a page's end) degrades gracefully: worst case, the short tail is read as its own single-column band, which reorders slightly but does not corrupt or drop content.
- **Empty or near-empty input**: `segment_regions(&[])` returns no regions, matching `group_lines`'s existing empty-input contract. Never panics.
- No `.unwrap()`/`.expect()` outside tests; no pdfium dependency in `columns.rs`; `cargo clippy -- -D warnings` clean — same standing constraints as the rest of the pipeline.

## Testing

New `src-tauri/src/pdf/columns_tests.rs`, following the same pattern as `layout_tests.rs`. Required synthetic cases:

- A single-column page stays one region (the core regression guard).
- A simple whole-page 2-column layout produces two regions, left before right.
- A full-width header above a 2-column body produces three regions in order: header, left column, right column.
- **Negative cases** — a stacked-fraction numerator/denominator gap, and a centered wide equation, must *not* trigger a false column split.

**Real-document verification is required before this feature is considered done**, consistent with every prior change to this pipeline (`CLAUDE.md`: "every bug found so far was invisible in synthetic fixtures alone"). No multi-column PDF exists in `notes/` today. This is an explicit, currently-blocked step in the implementation plan rather than a skipped one: implementation and the synthetic test suite above can proceed without it, but the feature should not be described as working on real multi-column documents until it has been checked — via the existing `NULL_NOTES_PDF=... cargo test dump_markdown -- --ignored --nocapture` diagnostic — against one.
