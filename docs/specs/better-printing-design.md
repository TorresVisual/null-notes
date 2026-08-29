# Better printing (reworking P3-2)

## Problem

P3-2 shipped "export to PDF" as `window.print()` behind a single File menu item. That was the right starting move — no custom renderer, math/Mermaid/ink/code all print exactly as shown — but it conflates two different actions and inherits Chromium's print-preview chrome as a side effect:

- **"Export to PDF" isn't really exporting.** It opens the print dialog and only becomes a PDF if the user manually picks "Save as PDF" as the target printer. There's no direct "write a PDF to this path" path.
- **There's no dedicated Print command at all.** The one menu item does double duty, and reaching an actual printer means going through the same dialog and picking a different target.
- **Every export/print carries Chromium's own header/footer**: a date/app-name line at the top of every page, a `tauri.localhost 1/9`-style URL/page-count line at the bottom. This is baked into the page by Chromium's print pipeline, not a CSS artifact — nothing in `@media print` controls it.
- Ctrl+P is bound to Quick Switcher (`src-tauri/src/lib.rs:95-98`), and WebView2's own browser-chrome accelerators are deliberately disabled (`src-tauri/src/lib.rs:198-215`) so that binding sticks. A side effect: there is currently no keyboard path to printing at all, intentional or not.

## Constraint that shapes the whole design

WebView2's native header/footer is **one on/off switch** (`CoreWebView2PrintSettings.ShouldPrintHeaderAndFooter`) covering date, app title, URL, and page number together. There is no API to request page numbers alone — Chromium doesn't expose per-field control, and CSS Paged Media margin boxes (`@page { @bottom-center { content: ... } }`) aren't implemented in Chromium at all. So "opt-in page numbers" necessarily means opting into the whole bundle. The alternative — hand-rolling page numbers by simulating Chromium's pagination in JS — is a much larger, fragile undertaking for a cosmetic feature, and is out of scope.

Decision: one checkbox, "Include page numbers, date, and title," off by default. Checking it enables the native bundle as-is. No attempt to strip individual fields from it.

## Two separate commands, one settings object

**Export to PDF** (`export_pdf`) and **Print** (`print_document`) are separate File menu items, each opening its own small dialog, each ending in a silent WebView2 call — never the Chromium print-preview UI, never the "did you remember to pick Save as PDF" indirection:

- `export_pdf(path, include_header_footer)` calls WebView2's `PrintToPdf(path, settings)` directly. No dialog beyond our own — the OS Save-As dialog (`tauri-plugin-dialog`, already a dependency) supplies `path`.
- `print_document(printer_name, include_header_footer)` calls WebView2's silent `Print(settings, handler)` — not `ShowPrintUI`, which would reopen exactly the Chromium print-preview chrome this feature removes. Printer selection is therefore our own dialog, backed by `list_printers()` (Win32 `EnumPrintersW`, needs the `Win32_Graphics_Printing` feature flag added to the `windows` crate dependency).

Both live in a new `src-tauri/src/commands/printing.rs`, following the one-file-per-domain command convention. Both grab the same `"main"` webview via `with_webview`, the pattern already established in `lib.rs:198-215` for the accelerator-key fix — this is the second caller of `webview2-com` in the codebase, not the first.

## Frontend

- `src/components/ExportPdfDialog.tsx` — checkbox + "Choose Location & Export…" button. The button triggers `dialog.save()` for the destination, then invokes `export_pdf`.
- `src/components/PrintDialog.tsx` — printer `<select>` (populated from `list_printers`, defaulting to the system default printer) + the same checkbox + a Print button, invoking `print_document`.
- Both wire into `Layout.tsx` the same way existing overlays (`template`, `switcher`) do. `File > Print…` is a new `MenuItem` in `lib.rs`'s `file_menu`, no accelerator — consistent with other infrequent items (`New Canvas Note`, `Generate Formula Sheet…`) that also have none.
- Both dialogs reuse the existing raw→wysiwyg switch-before-printing logic already in `Layout.tsx:168-179` (the print stylesheet only styles the rendered view).
- Command failure (bad path, printer offline, COM error) surfaces through the existing `store/toast.ts` / `ToastStack.tsx` — no new error-display mechanism.

## Pagination/layout audit

The existing `@media print` block (`src/index.css:3621-3675`) has two real gaps — content silently mangled across a page break, not cosmetic:

- `break-after: avoid` is set on `h1, h2, h3` only. An `h4`/`h5`/`h6` can land alone at the bottom of a page with its content starting on the next.
- `break-inside: avoid` covers code blocks, PDF page blocks, ink, tables, images, callouts — but not `.block-math` (KaTeX block equations) or `.mermaid-block` / `.diagram-block-preview` (diagrams). Either can currently be sliced across a page boundary mid-equation or mid-diagram.

Fix: extend both existing selector lists to include the missing selectors. No new mechanism — the rules already exist and already work for the block types they cover.

## Testing

- Rust: the COM/spooler calls need a live webview and installed printers, neither available in CI — same shape as `pdf/dump.rs`'s `#[ignore]`d diagnostics. They stay `#[ignore]`d, verified manually. Any pure logic factored out (building a `CoreWebView2PrintSettings`-equivalent struct from `include_header_footer` + a printer name) gets a real unit test.
- Frontend: vitest for both new dialogs, mocking `invoke` and `dialog.save`, asserting the right arguments go out on submit and that the checkbox state round-trips.
- Pagination CSS: not meaningfully unit-testable; verified visually via the `ui-preview` skill (browser print-preview) against a note containing headings, a block equation, and a diagram near a page boundary.

## Out of scope

- Persisted printing preferences (Settings panel). Both dialogs are one-off, per-action — nothing is remembered between exports/prints.
- Per-field header/footer control (e.g., page numbers without date/title). Blocked by the WebView2 API constraint above; revisit only if a future WebView2 version splits the setting.
- Non-Windows printing. The app is Windows-primary; this feature is Windows-only by construction (`webview2-com`, `EnumPrintersW`).
- Print margins, paper size, orientation pickers. Not requested; WebView2's settings default (matching the current `window.print()` behavior) carries over unchanged.
