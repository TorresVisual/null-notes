# Better printing (reworking P3-2)

## Problem

P3-2 shipped "export to PDF" as `window.print()` behind a single File menu item. That was the right starting move — no custom renderer, math/Mermaid/ink/code all print exactly as shown — but it conflates two different actions and inherits Chromium's print-preview chrome as a side effect:

- **"Export to PDF" isn't really exporting.** It opens the print dialog and only becomes a PDF if the user manually picks "Save as PDF" as the target printer. There's no direct "write a PDF to this path" path.
- **There's no dedicated Print command at all.** The one menu item does double duty, and reaching an actual printer means going through the same dialog and picking a different target.
- **Every export/print carries Chromium's own header/footer**: a date/app-name line at the top of every page, a `tauri.localhost 1/9`-style URL/page-count line at the bottom. This is baked into the page by Chromium's print pipeline, not a CSS artifact — nothing in `@media print` controls it.
- Ctrl+P is bound to Quick Switcher (`src-tauri/src/lib.rs:95-98`), and WebView2's own browser-chrome accelerators are deliberately disabled (`src-tauri/src/lib.rs:198-215`) so that binding sticks. A side effect: there is currently no keyboard path to printing at all, intentional or not.

## Constraint that shapes the whole design

WebView2's native header/footer is **one on/off switch** (`CoreWebView2PrintSettings.ShouldPrintHeaderAndFooter`) covering date, app title, URL, and page number together. There is no API to request page numbers alone — Chromium doesn't expose per-field control, and CSS Paged Media margin boxes (`@page { @bottom-center { content: ... } }`) aren't implemented in Chromium at all. So "opt-in page numbers" via the native mechanism necessarily means opting into the whole bundle, with no preview of what it'll look like until the PDF/print job already exists.

**v1 decision (superseded below):** one checkbox, "Include page numbers, date, and title," off by default, enabling the native bundle as-is.

**v2 decision:** stop using WebView2's native header/footer at all. [Paged.js](https://pagedjs.org/) — a CSS Paged Media polyfill — computes real page breaks in the browser and *does* implement `@page` margin boxes, `counter(page)`/`counter(pages)`, and running content. Rendering the note through it gives independent Page number / Title / Date controls and, as a direct consequence, an actual print preview (Paged.js's output is a real paginated DOM the user can see before printing) — both of which are otherwise blocked by the constraint above. `ShouldPrintHeaderAndFooter` is hardcoded `false` from here on.

## Real pagination via Paged.js

`src/hooks/usePrintPreview.ts` wraps Paged.js's `Previewer`:

1. Clone the note's rendered content (the same `.editor-pane` DOM the raw→wysiwyg switch already guarantees is showing).
2. Build a small `@page` stylesheet string from three booleans (`showPageNumber`, `showTitle`, `showDate`) plus the note title and today's date, and inject it as a `<style>` element — Paged.js scans the document's existing stylesheets automatically (it even unwraps `@media print { … }` blocks it finds, so the app's existing print rules apply for free), so nothing needs to be passed through `Previewer.preview()`'s stylesheet-URL argument.
3. Call `new Previewer().preview(clone, [], container)`. The promise resolves with a `flow` (`flow.total` pages); re-run on any checkbox change or content change (debounced).

**Page size must match on both sides of the print call.** Paged.js renders each page as a fixed-size box (`size: letter` in our `@page` rule) with a break between them; if WebView2's own page size/margins don't match exactly, the print pipeline rescales or mis-splits those boxes. `build_print_settings` (Rust) now hardcodes the same Letter size with **zero** WebView2-side margins — Paged.js's own `@page margin` is the only margin in effect, so one Paged.js page maps to exactly one physical page.

Paged.js implements standard CSS Fragmentation (`break-inside`, `break-before`, `break-after`) properly, so the selector-list fixes in "Pagination/layout audit" below keep mattering — Paged.js is what actually enforces them now, more reliably than Chromium's own approximate print layout ever did.

## Two separate commands, one settings object

**Export to PDF** (`export_pdf`) and **Print** (`print_document`) are separate File menu items, each opening its own small dialog, each ending in a silent WebView2 call — never the Chromium print-preview UI, never the "did you remember to pick Save as PDF" indirection:

- `export_pdf(path)` calls WebView2's `PrintToPdf(path, settings)` directly. No dialog beyond our own — the OS Save-As dialog (`tauri-plugin-dialog`, already a dependency) supplies `path`.
- `print_document(printer_name)` calls WebView2's silent `Print(settings, handler)` — not `ShowPrintUI`, which would reopen exactly the Chromium print-preview chrome this feature removes (Paged.js's in-dialog preview is the preview now). Printer selection is therefore our own dialog, backed by `list_printers()` (Win32 `EnumPrintersW`, needs the `Win32_Graphics_Printing` feature flag added to the `windows` crate dependency).
- Both commands' `settings` object is now fixed: `ShouldPrintHeaderAndFooter(false)`, Letter page size, zero margins. `include_header_footer` is gone from both signatures — there's nothing left for it to toggle on the WebView2 side.

Both live in `src-tauri/src/commands/printing.rs`, following the one-file-per-domain command convention. Both grab the same `"main"` webview via `with_webview`, the pattern already established in `lib.rs:198-215` for the accelerator-key fix.

## Frontend

- `src/hooks/usePrintPreview.ts` — the shared Paged.js wiring described above. Returns `{ containerRef, showPageNumber, setShowPageNumber, showTitle, setShowTitle, showDate, setShowDate, isReady, error }`.
- `src/components/ExportPdfDialog.tsx` — three checkboxes + the preview pane (via the hook) + "Choose Location & Export…" button. The button triggers `dialog.save()` for the destination, then invokes `export_pdf`.
- `src/components/PrintDialog.tsx` — printer `<select>` (populated from `list_printers`, defaulting to the system default printer) + the same three checkboxes/preview + a Print button, invoking `print_document`.
- Both wire into `Layout.tsx` the same way existing overlays (`template`, `switcher`) do. `File > Print…` is a `MenuItem` in `lib.rs`'s `file_menu`, no accelerator — consistent with other infrequent items (`New Canvas Note`, `Generate Formula Sheet…`) that also have none.
- Both dialogs reuse the existing raw→wysiwyg switch-before-printing logic already in `Layout.tsx` (the print stylesheet only styles the rendered view, and `usePrintPreview` clones from it).
- `src/index.css`'s `@media print` block, which currently hides all dialog content unconditionally (`[data-slot="dialog-content"] { display: none !important; }`), gets a `:has()`-based exception: dialog content containing the Paged.js pages container stays visible, but only that container — everything else inside the dialog (checkboxes, buttons) is hidden. `:has()` is safe here since this app only ever runs in one engine (WebView2/Chromium).
- Command failure (bad path, printer offline, COM error, or a Paged.js pagination exception) surfaces through the existing `store/toast.ts` / `ToastStack.tsx` — no new error-display mechanism. A pagination failure also disables Export/Print until a re-render succeeds.

## Pagination/layout audit

The existing `@media print` block (`src/index.css:3621-3675`) has two real gaps — content silently mangled across a page break, not cosmetic:

- `break-after: avoid` is set on `h1, h2, h3` only. An `h4`/`h5`/`h6` can land alone at the bottom of a page with its content starting on the next.
- `break-inside: avoid` covers code blocks, PDF page blocks, ink, tables, images, callouts — but not `.block-math` (KaTeX block equations) or `.mermaid-block` / `.diagram-block-preview` (diagrams). Either can currently be sliced across a page boundary mid-equation or mid-diagram.

Fix: extend both existing selector lists to include the missing selectors. No new mechanism — the rules already exist and already work for the block types they cover.

## Testing

- Rust: the COM/spooler calls need a live webview and installed printers, neither available in CI — same shape as `pdf/dump.rs`'s `#[ignore]`d diagnostics. They stay `#[ignore]`d, verified manually. Any pure logic factored out (building the fixed print-settings struct, pairing printer names with the default) gets a real unit test.
- Frontend: Paged.js does real layout/CSS work jsdom can't execute (same limitation as this repo's canvas-based ink tests). `usePrintPreview`'s tests mock `pagedjs`'s `Previewer`, asserting it's constructed and `.preview()` is called with a stylesheet reflecting the current checkbox states. Dialog tests mock the hook itself, asserting the right arguments go out on Export/Print submit and that checkbox state is passed through.
- Actual pagination correctness (does Paged.js really break where our CSS says it should, does WebView2 really print one physical page per Paged.js page): not meaningfully unit-testable; verified visually via the `ui-preview` skill and manually via `npm run tauri dev`, against a note containing headings, a block equation, and a diagram near a page boundary.
- Pagination CSS (`break-after`/`break-inside` selector lists): same as above — verified visually, not unit-tested.

## Out of scope

- Persisted printing preferences (Settings panel). Both dialogs are one-off, per-action — nothing is remembered between exports/prints.
- Non-Windows printing. The app is Windows-primary; this feature is Windows-only by construction (`webview2-com`, `EnumPrintersW`).
- Print margins, paper size, orientation pickers as *user-facing* controls. Paged.js's `@page` size/margin is fixed at Letter/1in internally so it can stay in lockstep with WebView2's own settings (see "Real pagination via Paged.js" above) — exposing these as pickers is a separate, later feature.
- A native Chromium print-preview dialog (`ShowPrintUI`). Paged.js's in-dialog preview replaces the need for it.
