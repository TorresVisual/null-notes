# Export to PDF — print from a dedicated mount, A4 only

Supersedes the "dialog is the print surface" parts of `better-printing-design.md`. Everything else in that spec (Paged.js pagination, independent page number / title / date fields, silent `PrintToPdf`) stays.

## Problem

`temp/A0-Notes.pdf` (23 Letter pages) exports with every page's content shifted ~300px left, clipping the left edge of code blocks and paragraphs, and displaced vertically so Paged.js page boxes straddle physical pages. The print job prints the Radix dialog that holds the preview, and `@media print` has to undo the dialog's `fixed`/centring/`translate`/`scale`/overlay/60vh clipping to make it look like a bare page stack. That reset block has been patched repeatedly (`translate`, `#root`, trailing blank page) and still misplaces pages.

## Goal

File > Export to PDF: preview in the dialog, one click to **Choose Location & Export**, and the saved PDF's pages are exactly the previewed A4 pages, correctly placed, nothing clipped.

Non-goals: physical Print (works only as far as it shares code, see below), paper-size/margin pickers, persisted preferences, non-Windows.
Anti-goal: a second window, a new Vite entry, or a custom renderer.

## Decisions

- **A4 only.** `@page { size: A4; margin: 20mm }` in `buildPageCss`; Rust `build_print_settings` uses 210/25.4 × 297/25.4 in (8.2677 × 11.6929), margins still 0. Letter is removed, not made optional.
- **Print mount.** On Export, after the save dialog returns a path: paginate the note again with Paged.js into a plain `<div id="print-root">` appended to `document.body` (not Radix, not portaled, no positioning). Hide `#root` and the dialog with one `body.printing` class, call `export_pdf`, remove the mount and class in a `finally`.
- **Dialog stays the preview only.** Its `@media print` reset block (`[data-slot="dialog-content"]:has(...)`, `translate/scale/transform` resets, `.print-preview-pages` overrides) is deleted; the print CSS reduces to: hide `#root` + dialog while `body.printing`, light palette, `print-color-adjust`, no gap/shadow between `.pagedjs_page`, suppress the trailing break on the last page.
- **Shared by Print.** The "paginate into mount, run a callback, tear down" step is one function used by both Export and Print, so `PrintDialog` changes by a couple of lines and loses the dialog print CSS too. Print is not otherwise touched or verified (no printer available here).
- **Fragmentation rules** (`break-after: avoid` on headings, `break-inside: avoid` on code/math/diagrams/etc.) are currently scoped to `.print-preview-pages`; they must also apply inside `#print-root`, since Paged.js reads them off the clone while it sits in its container.

## Approaches considered

- **A. Debug the existing dialog-print chain** — smallest diff, same fragile design that failed twice. Rejected.
- **B. Hidden second webview that loads only the pages** — cleanest isolation, but a new window, entry point, and a way to ship rendered ink/Mermaid/KaTeX DOM across. Rejected as disproportionate.
- **C. Print mount outside the dialog** — chosen (you picked it): removes the cause instead of patching it, no new window.

## Left to the builder

- Paged.js's `Polisher` appends `@page` styles to `<head>`; two live `Previewer`s (dialog preview + print mount) must not leave conflicting `@page` rules behind. Either tear the preview down before the print pass and re-render it if export fails, or move the already-paginated pages node into the mount instead of paginating twice. Pick whichever keeps the PDF identical to the preview.
- The mount must be laid out (not `display: none`) while Paged.js measures it, e.g. off-screen, then switched into normal flow for printing.
- Export button must stay disabled while the preview renders (as now).

## Verification

Reuse the `A0-Notes` content (the failing note). Export through the real app, then check with `pdfinfo` (page size 595×842 pt, sensible page count) and render pages to images to confirm nothing is clipped, no blank leading/trailing page, margins even, code blocks and headings not split. Unit tests: `buildPageCss` emits A4/20mm; the Rust print-settings dimensions. The pagination-vs-physical-page match is only verifiable on the real output, as in the existing spec.

## What the first implementation got wrong

Found by exporting a real 25-page note and comparing Paged.js's output in the preview with the print mount (all fixed, covered by `e2e/specs/print-export-pdf.e2e.ts`):

- **The mount was parked at `left: -100000px`.** Paged.js emitted a blank first page and laid the first page out twice (25 pages against the preview's 19). The mount is now measured at the origin, `width: 210mm; visibility: hidden`.
- **Preview and print paginated differently.** The preview sat in a `text-sm` dialog, the print mount in `body`, so the cloned note inherited two font sizes. `font`/`color` are pinned on both containers.
- **Paged.js does not read `break-after: avoid` from CSS**, so headings and the file-name line above a code block were stranded at page bottoms. Keep-with-next is set as data attributes on the clone; code blocks up to 8 lines stay whole, longer ones split so pages are not left half empty.
- **Paged.js drops whitespace-only text nodes in the continuation of a split block** (indentation, blank-line newlines, spaces between highlighted tokens). Each gets a zero-width space.
- **Tables scrolled sideways** (`overflow-x: auto`, grip padding, unbreakable inline code). Print uses fixed layout, `overflow-wrap: anywhere`, and no controls.
- **Syntax colours were the dark-theme pastels** on a light page; a light palette is applied in both containers.
