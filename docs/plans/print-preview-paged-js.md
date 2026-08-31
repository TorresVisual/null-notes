# Print Preview via Paged.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Replace the single bundled "Include page numbers, date, and title" checkbox with a real, live-paginated print preview and three independent checkboxes (Page numbers / Title / Date), built on Paged.js instead of WebView2's native (all-or-nothing) header/footer.

**Architecture:** A new `usePrintPreview` hook clones the note's rendered content, injects a dynamic `@page` stylesheet built from the three checkbox states, and renders it through Paged.js's `Previewer` into a container both dialogs display. WebView2's native `ShouldPrintHeaderAndFooter` is hardcoded off; `export_pdf`/`print_document` now fix page size (Letter) and margins (zero) so a Paged.js page maps 1:1 to one physical printed page — Paged.js's own `@page margin` is the only margin in effect.

**Tech Stack:** `pagedjs` (new npm dependency) for CSS Paged Media pagination in the browser; existing React/TypeScript dialog components; existing Rust WebView2 COM plumbing (`src-tauri/src/commands/printing.rs`).

**Spec:** `docs/specs/better-printing-design.md` (see "Constraint that shapes the whole design" v2 decision, "Real pagination via Paged.js", and the updated "Frontend"/"Testing"/"Out of scope" sections) — read it alongside this plan.

## Global Constraints

- No `.unwrap()`/`.expect()` outside Rust tests (CLAUDE.md).
- Strict TypeScript: no `any`; `pagedjs` ships no types, so a minimal ambient declaration is required (ambient `.d.ts` files, no external `@types` package exists).
- `cargo clippy -- -D warnings` and `cargo fmt --check` must pass locally before pushing (CLAUDE.md).
- Pure logic (CSS string building, date formatting) lives in `src/lib/` (no React) per CLAUDE.md's project structure, separate from the React hook that uses it.
- Paged.js does real layout/CSS work jsdom can't execute — its `Previewer` is mocked in tests; actual pagination correctness is a manual/`ui-preview` check, same posture as the already-shipped pagination CSS fixes.
- `:has()` CSS is safe to use — this app only ever runs inside one engine (WebView2/Chromium desktop), per the spec's "Frontend" section.

---

## File structure

- **Modify** `package.json` — add `pagedjs` dependency.
- **Create** `src/types/pagedjs.d.ts` — ambient module declaration for the one class/method this app uses.
- **Create** `src/lib/printPreviewCss.ts` + `printPreviewCss.test.ts` — pure `buildPageCss(options)` and `formatPrintDate(date)` helpers.
- **Create** `src/hooks/usePrintPreview.ts` + `usePrintPreview.test.tsx` — the Paged.js wiring, mocking `pagedjs` in tests.
- **Modify** `src-tauri/src/commands/printing.rs` — drop `include_header_footer` from `build_print_settings`/`export_pdf`/`print_document`; hardcode `SetShouldPrintHeaderAndFooter(false)`, fixed Letter page size, zero margins.
- **Modify** `src/lib/tauri.ts` — drop `includeHeaderFooter` from `api.printing.exportPdf`/`printDocument`.
- **Modify** `src/index.css` — `:has()` print exception for the paginated-pages container; wider/scrollable dialog sizing for the two print dialogs.
- **Modify** `src/components/ExportPdfDialog.tsx` + test — three checkboxes + preview pane via the hook, new `contentEl` prop, drop the old single checkbox and `includeHeaderFooter` arg.
- **Modify** `src/components/PrintDialog.tsx` + test — same.
- **Modify** `src/components/Layout.tsx` — pass `editorPaneRef.current` as `contentEl` to both dialogs.

---

## Task 1: `pagedjs` dependency + ambient types

**Files:**
- Modify: `package.json`
- Create: `src/types/pagedjs.d.ts`

**Interfaces:**
- Produces: `import { Previewer } from 'pagedjs'` typed as `new Previewer()` with `.preview(content: Node, stylesheets: string[], renderTo: Element): Promise<{ total: number }>`.

- [ ] **Step 1: Install the dependency**

Run: `npm install pagedjs@^0.4.3`
Expected: `package.json`/`package-lock.json` gain `pagedjs`.

- [ ] **Step 2: Add the ambient type declaration**

```ts
// src/types/pagedjs.d.ts
declare module 'pagedjs' {
  export interface PagedFlow {
    total: number
  }

  export class Previewer {
    preview(content: Node, stylesheets: string[], renderTo: Element): Promise<PagedFlow>
  }
}
```

- [ ] **Step 3: Verify the typecheck passes with an unused import removed after check**

Run: `npm run typecheck`
Expected: passes (nothing imports `pagedjs` yet, this just confirms the ambient module doesn't break anything).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/types/pagedjs.d.ts
git commit -m "chore: add pagedjs dependency and ambient types"
```

---

## Task 2: Pure `printPreviewCss` helpers

**Files:**
- Create: `src/lib/printPreviewCss.ts`
- Create: `src/lib/printPreviewCss.test.ts`

**Interfaces:**
- Produces: `buildPageCss(options: { showPageNumber: boolean; showTitle: boolean; showDate: boolean; title: string; date: string }): string`; `formatPrintDate(date: Date): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/printPreviewCss.test.ts
import { describe, it, expect } from 'vitest'
import { buildPageCss, formatPrintDate } from './printPreviewCss'

describe('buildPageCss', () => {
  it('includes no margin-box rules when every field is off', () => {
    const css = buildPageCss({ showPageNumber: false, showTitle: false, showDate: false, title: 'Lecture 7', date: 'August 31, 2026' })
    expect(css).not.toContain('@bottom-center')
    expect(css).not.toContain('@top-left')
    expect(css).not.toContain('@top-right')
    expect(css).toContain('@page')
  })

  it('includes a page-number counter only when showPageNumber is true', () => {
    const css = buildPageCss({ showPageNumber: true, showTitle: false, showDate: false, title: 'Lecture 7', date: 'August 31, 2026' })
    expect(css).toContain('@bottom-center')
    expect(css).toContain('counter(page)')
    expect(css).toContain('counter(pages)')
    expect(css).not.toContain('@top-left')
  })

  it('includes the title only when showTitle is true, escaped for CSS string content', () => {
    const css = buildPageCss({ showPageNumber: false, showTitle: true, showDate: false, title: 'Lecture "7"', date: 'August 31, 2026' })
    expect(css).toContain('@top-left')
    expect(css).toContain('Lecture \\"7\\"')
  })

  it('includes the date only when showDate is true', () => {
    const css = buildPageCss({ showPageNumber: false, showTitle: false, showDate: true, title: 'Lecture 7', date: 'August 31, 2026' })
    expect(css).toContain('@top-right')
    expect(css).toContain('August 31, 2026')
  })

  it('includes all three together', () => {
    const css = buildPageCss({ showPageNumber: true, showTitle: true, showDate: true, title: 'Lecture 7', date: 'August 31, 2026' })
    expect(css).toContain('@bottom-center')
    expect(css).toContain('@top-left')
    expect(css).toContain('@top-right')
  })
})

describe('formatPrintDate', () => {
  it('formats a date as a locale-readable string', () => {
    expect(formatPrintDate(new Date(2026, 7, 31))).toBe(new Date(2026, 7, 31).toLocaleDateString())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run printPreviewCss`
Expected: FAIL — `./printPreviewCss` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/printPreviewCss.ts

// Paged.js is a CSS Paged Media polyfill — content in a margin-box string
// is CSS `content: "..."`, so a literal `"` or `\` inside the title needs
// the same escaping a CSS string literal needs.
function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

interface PageCssOptions {
  showPageNumber: boolean
  showTitle: boolean
  showDate: boolean
  title: string
  date: string
}

/**
 * WebView2's native header/footer bundles page number, title, date and URL
 * behind one on/off switch (see docs/specs/better-printing-design.md).
 * This builds the equivalent CSS Paged Media `@page` rule instead, where
 * each field really is independent.
 */
export function buildPageCss({ showPageNumber, showTitle, showDate, title, date }: PageCssOptions): string {
  const marginBoxes: string[] = []
  if (showPageNumber) {
    marginBoxes.push('@bottom-center { content: "Page " counter(page) " of " counter(pages); }')
  }
  if (showTitle) {
    marginBoxes.push(`@top-left { content: "${escapeCssString(title)}"; }`)
  }
  if (showDate) {
    marginBoxes.push(`@top-right { content: "${escapeCssString(date)}"; }`)
  }
  return `@page { size: letter; margin: 1in; ${marginBoxes.join(' ')} }`
}

export function formatPrintDate(date: Date): string {
  return date.toLocaleDateString()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run printPreviewCss`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/printPreviewCss.ts src/lib/printPreviewCss.test.ts
git commit -m "feat: add pure @page CSS builder for independent print fields"
```

---

## Task 3: `usePrintPreview` hook

**Files:**
- Create: `src/hooks/usePrintPreview.ts`
- Create: `src/hooks/usePrintPreview.test.tsx` (`.tsx`, not `.ts` — the test renders a small harness component so the hook's `containerRef` is attached to a real DOM node the way a consumer actually would, before the hook's effect runs)

**Interfaces:**
- Consumes: `buildPageCss`, `formatPrintDate` (Task 2); `Previewer` from `pagedjs` (Task 1).
- Produces:
  ```ts
  interface UsePrintPreviewResult {
    containerRef: React.RefObject<HTMLDivElement>
    showPageNumber: boolean
    setShowPageNumber: (value: boolean) => void
    showTitle: boolean
    setShowTitle: (value: boolean) => void
    showDate: boolean
    setShowDate: (value: boolean) => void
    isRendering: boolean
    error: string | null
  }
  function usePrintPreview(contentEl: HTMLElement | null, noteTitle: string): UsePrintPreviewResult
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
// src/hooks/usePrintPreview.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { usePrintPreview } from './usePrintPreview'

// vi.hoisted lets the mock factory below (which vitest hoists above this
// file's imports) share this function reference, so each test can control
// what the mocked Previewer resolves/rejects with.
const previewMock = vi.hoisted(() => vi.fn())

vi.mock('pagedjs', () => ({
  // A plain arrow function can't be used with `new` — the hook constructs
  // this with `new Previewer()`, so the mock needs a real constructor.
  Previewer: vi.fn().mockImplementation(function MockPreviewer() {
    return { preview: previewMock }
  }),
}))

interface HarnessProps {
  contentEl: HTMLElement | null
  noteTitle: string
  onResult: (result: ReturnType<typeof usePrintPreview>) => void
}

// A hook that returns a ref meant to be attached to a DOM node has to be
// exercised through a real render, not renderHook() in isolation — the ref
// needs to be attached during commit, before the hook's own effect runs,
// exactly like a real consumer (ExportPdfDialog/PrintDialog) does.
function Harness({ contentEl, noteTitle, onResult }: HarnessProps) {
  const result = usePrintPreview(contentEl, noteTitle)
  onResult(result)
  return <div ref={result.containerRef} />
}

function makeContentEl(): HTMLElement {
  const el = document.createElement('div')
  el.textContent = 'Note content'
  return el
}

beforeEach(() => {
  previewMock.mockResolvedValue({ total: 3 })
})

afterEach(() => {
  // Unmounting runs the hook's own effect cleanup (which removes the
  // <style> tag it created) — a manual DOM sweep here would race with
  // that and remove the node out from under it.
  cleanup()
  vi.clearAllMocks()
})

describe('usePrintPreview', () => {
  it('does nothing without a content element', () => {
    render(<Harness contentEl={null} noteTitle="Lecture 7" onResult={() => {}} />)
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('renders the preview once a content element is provided', async () => {
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={() => {}} />)

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))
    expect(previewMock).toHaveBeenCalledWith(expect.any(Node), [], expect.any(HTMLDivElement))
  })

  it('re-renders with page-number CSS when showPageNumber is toggled on', async () => {
    let latest: ReturnType<typeof usePrintPreview> | undefined
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={(r) => { latest = r }} />)
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))

    act(() => {
      latest?.setShowPageNumber(true)
    })

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2))
    const injectedStyle = document.head.querySelector('style')
    expect(injectedStyle?.textContent).toContain('counter(page)')
  })

  it('surfaces a pagination failure as an error and clears isRendering', async () => {
    previewMock.mockRejectedValue(new Error('paged.js exploded'))
    let latest: ReturnType<typeof usePrintPreview> | undefined
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={(r) => { latest = r }} />)

    await waitFor(() => expect(latest?.error).toBe('paged.js exploded'))
    expect(latest?.isRendering).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run usePrintPreview`
Expected: FAIL — `./usePrintPreview` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/hooks/usePrintPreview.ts
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Previewer } from 'pagedjs'
import { buildPageCss, formatPrintDate } from '../lib/printPreviewCss'

interface UsePrintPreviewResult {
  containerRef: RefObject<HTMLDivElement>
  showPageNumber: boolean
  setShowPageNumber: (value: boolean) => void
  showTitle: boolean
  setShowTitle: (value: boolean) => void
  showDate: boolean
  setShowDate: (value: boolean) => void
  isRendering: boolean
  error: string | null
}

// Re-rendering on every keystroke-speed checkbox toggle would thrash
// Paged.js's real layout pass; this waits for toggling to settle first.
const RERENDER_DEBOUNCE_MS = 250

/**
 * Clones `contentEl` and paginates it through Paged.js into whatever
 * element `containerRef` is attached to, re-running whenever a checkbox
 * or the content changes. See docs/specs/better-printing-design.md's
 * "Real pagination via Paged.js" for why this replaces WebView2's native
 * (all-or-nothing) header/footer.
 */
export function usePrintPreview(contentEl: HTMLElement | null, noteTitle: string): UsePrintPreviewResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showPageNumber, setShowPageNumber] = useState(false)
  const [showTitle, setShowTitle] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [isRendering, setIsRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!contentEl || !container) return

    const styleEl = document.createElement('style')
    styleEl.textContent = buildPageCss({
      showPageNumber,
      showTitle,
      showDate,
      title: noteTitle,
      date: formatPrintDate(new Date()),
    })
    document.head.appendChild(styleEl)

    let cancelled = false
    setIsRendering(true)
    setError(null)
    const timer = setTimeout(() => {
      container.innerHTML = ''
      const clone = contentEl.cloneNode(true) as HTMLElement
      new Previewer()
        .preview(clone, [], container)
        .then(() => {
          if (!cancelled) setIsRendering(false)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setIsRendering(false)
          setError(e instanceof Error ? e.message : String(e))
        })
    }, RERENDER_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.head.removeChild(styleEl)
    }
  }, [contentEl, showPageNumber, showTitle, showDate, noteTitle])

  return {
    containerRef,
    showPageNumber,
    setShowPageNumber,
    showTitle,
    setShowTitle,
    showDate,
    setShowDate,
    isRendering,
    error,
  }
}
```

- [ ] **Step 4: Run tests, accounting for the debounce**

The tests use real timers with `waitFor`, which polls past the 250ms debounce automatically — no fake-timer setup needed.

Run: `npx vitest run usePrintPreview`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePrintPreview.ts src/hooks/usePrintPreview.test.tsx
git commit -m "feat: add usePrintPreview hook wrapping Paged.js"
```

---

## Task 4: Rust — fixed print settings, drop `include_header_footer`

**Files:**
- Modify: `src-tauri/src/commands/printing.rs`

**Interfaces:**
- Produces: `build_print_settings(core_webview: &ICoreWebView2, printer_name: Option<&str>) -> windows::core::Result<ICoreWebView2PrintSettings>` (drops the `include_header_footer` parameter); `export_pdf(app: tauri::AppHandle, path: String) -> Result<(), String>`; `print_document(app: tauri::AppHandle, printer_name: String) -> Result<(), String>` (both drop `include_header_footer`).

No new automated test — same manual-verification posture as the rest of this file (needs a live WebView2 instance). Verified in Task 8's full pass once the frontend no longer sends the removed argument.

- [ ] **Step 1: Update `build_print_settings`**

```rust
// src-tauri/src/commands/printing.rs — replace the existing build_print_settings
#[cfg(windows)]
fn build_print_settings(
    core_webview: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    printer_name: Option<&str>,
) -> windows::core::Result<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PrintSettings> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_2,
    };
    use windows::core::{Interface, HSTRING};

    unsafe {
        let environment = core_webview.cast::<ICoreWebView2_2>()?.Environment()?;
        let settings = environment
            .cast::<ICoreWebView2Environment6>()?
            .CreatePrintSettings()?;
        // Paged.js renders its own running headers/footers now (see
        // docs/specs/better-printing-design.md) — WebView2's native,
        // all-or-nothing bundle stays off unconditionally.
        settings.SetShouldPrintHeaderAndFooter(false)?;
        // Fixed Letter size with zero WebView2-side margin so a Paged.js
        // page (which sets its own `@page { size: letter; margin: 1in }`)
        // maps to exactly one physical page — Paged.js's margin is the
        // only margin in effect.
        settings.SetPageWidth(8.5)?;
        settings.SetPageHeight(11.0)?;
        settings.SetMarginTop(0.0)?;
        settings.SetMarginBottom(0.0)?;
        settings.SetMarginLeft(0.0)?;
        settings.SetMarginRight(0.0)?;
        if let Some(name) = printer_name {
            settings
                .cast::<ICoreWebView2PrintSettings2>()?
                .SetPrinterName(&HSTRING::from(name))?;
        }
        Ok(settings)
    }
}
```

- [ ] **Step 2: Update `export_pdf_sync`/`export_pdf` to drop `include_header_footer`**

```rust
// src-tauri/src/commands/printing.rs — replace export_pdf_sync's signature and call site
#[cfg(windows)]
fn export_pdf_sync(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_7;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let webview = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    run_on_main_webview(&webview, move |core_webview| unsafe {
        let settings = build_print_settings(&core_webview, None).map_err(|e| e.to_string())?;
        let core_webview_7 = core_webview
            .cast::<ICoreWebView2_7>()
            .map_err(|e| e.to_string())?;
        let path_hstring = HSTRING::from(path.as_str());
        PrintToPdfCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| {
                core_webview_7
                    .PrintToPdf(&path_hstring, &settings, &handler)
                    .map_err(webview2_com::Error::from)
            }),
            Box::new(|hresult: windows::core::Result<()>, succeeded: bool| {
                hresult?;
                if succeeded {
                    Ok(())
                } else {
                    Err(windows::core::Error::new(
                        windows::core::HRESULT(0x8000_4005_u32 as i32),
                        "PrintToPdf reported failure",
                    ))
                }
            }),
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn export_pdf(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(move || export_pdf_sync(&app, path))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("Printing is only supported on Windows.".to_string())
    }
}
```

- [ ] **Step 3: Update `print_document_sync`/`print_document` to drop `include_header_footer`**

```rust
// src-tauri/src/commands/printing.rs — replace print_document_sync's signature and call site
#[cfg(windows)]
fn print_document_sync(app: &tauri::AppHandle, printer_name: String) -> Result<(), String> {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_16, COREWEBVIEW2_PRINT_STATUS, COREWEBVIEW2_PRINT_STATUS_SUCCEEDED,
    };
    use webview2_com::PrintCompletedHandler;
    use windows::core::Interface;

    let webview = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    run_on_main_webview(&webview, move |core_webview| unsafe {
        let settings =
            build_print_settings(&core_webview, Some(&printer_name)).map_err(|e| e.to_string())?;
        let core_webview_16 = core_webview.cast::<ICoreWebView2_16>().map_err(|e| e.to_string())?;
        PrintCompletedHandler::wait_for_async_operation(
            Box::new(move |handler| {
                core_webview_16.Print(&settings, &handler).map_err(webview2_com::Error::from)
            }),
            Box::new(|hresult: windows::core::Result<()>, status: COREWEBVIEW2_PRINT_STATUS| {
                hresult?;
                if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED {
                    Ok(())
                } else {
                    Err(windows::core::Error::new(
                        windows::core::HRESULT(0x8000_4005_u32 as i32),
                        "Print reported failure",
                    ))
                }
            }),
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn print_document(app: tauri::AppHandle, printer_name: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(move || print_document_sync(&app, printer_name))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("Printing is only supported on Windows.".to_string())
    }
}
```

- [ ] **Step 4: Verify it compiles, lints, and formats clean**

Run: `cd src-tauri && cargo check && cargo clippy -- -D warnings && cargo fmt --check`
Expected: all clean. If `cargo fmt --check` flags this file, run `rustfmt src/commands/printing.rs` (not a blanket `cargo fmt`, to avoid touching this repo's other pre-existing formatting drift) and re-check.

- [ ] **Step 5: Run the existing Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: PASS — `mark_default`'s tests are untouched by this change.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/printing.rs
git commit -m "feat: fix WebView2 print settings for Paged.js, drop native header/footer toggle"
```

---

## Task 5: Frontend API — drop `includeHeaderFooter`

**Files:**
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Produces: `api.printing.exportPdf(path: string): Promise<void>`; `api.printing.printDocument(printerName: string): Promise<void>` (both lose their second parameter).

- [ ] **Step 1: Update the two calls**

```ts
// src/lib/tauri.ts — replace the printing.exportPdf/printDocument entries
  printing: {
    listPrinters: () =>
      invoke<PrinterInfo[]>('list_printers'),
    exportPdf: (path: string) =>
      invoke<void>('export_pdf', { path }),
    printDocument: (printerName: string) =>
      invoke<void>('print_document', { printerName }),
  },
```

- [ ] **Step 2: Verify the typecheck still passes**

Run: `npm run typecheck`
Expected: FAILS at this point — `ExportPdfDialog.tsx`/`PrintDialog.tsx` still call the old two-argument form. That's expected; Tasks 6-7 fix the call sites. Do not fix them here — this task's job is only the API surface.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat: drop includeHeaderFooter from the printing API client"
```

---

## Task 6: `ExportPdfDialog` — three checkboxes + live preview

**Files:**
- Modify: `src/components/ExportPdfDialog.tsx`
- Modify: `src/components/ExportPdfDialog.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `usePrintPreview` (Task 3); `api.printing.exportPdf(path: string)` (Task 5).
- Produces: `ExportPdfDialog({ noteTitle, contentEl, onClose }: { noteTitle: string; contentEl: HTMLElement | null; onClose: () => void })` — gains the `contentEl` prop.

- [ ] **Step 1: Rewrite the tests for the new prop and three checkboxes**

```tsx
// src/components/ExportPdfDialog.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPdfDialog } from './ExportPdfDialog'
import { api } from '../lib/tauri'
import { save } from '@tauri-apps/plugin-dialog'
import { showToast } from '../store/toast'
import { usePrintPreview } from '../hooks/usePrintPreview'

vi.mock('../lib/tauri', () => ({
  api: { printing: { exportPdf: vi.fn() } },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))
vi.mock('../hooks/usePrintPreview', () => ({
  usePrintPreview: vi.fn(),
}))

const exportPdf = vi.mocked(api.printing.exportPdf)
const saveDialog = vi.mocked(save)
const previewHook = vi.mocked(usePrintPreview)

function makePreviewResult(overrides: Partial<ReturnType<typeof usePrintPreview>> = {}) {
  return {
    containerRef: { current: null },
    showPageNumber: false,
    setShowPageNumber: vi.fn(),
    showTitle: false,
    setShowTitle: vi.fn(),
    showDate: false,
    setShowDate: vi.fn(),
    isRendering: false,
    error: null,
    ...overrides,
  }
}

beforeEach(() => {
  saveDialog.mockResolvedValue('C:\\notes\\Lecture 7.pdf')
  exportPdf.mockResolvedValue(undefined)
  previewHook.mockReturnValue(makePreviewResult())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ExportPdfDialog', () => {
  it('exports to the chosen path', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportPdfDialog noteTitle="Lecture 7" contentEl={null} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(saveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'Lecture 7.pdf' }))
    expect(exportPdf).toHaveBeenCalledWith('C:\\notes\\Lecture 7.pdf')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders three independent checkboxes wired to the preview hook', async () => {
    const setShowPageNumber = vi.fn()
    previewHook.mockReturnValue(makePreviewResult({ setShowPageNumber }))
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    await user.click(screen.getByLabelText('Page numbers'))

    expect(setShowPageNumber).toHaveBeenCalledWith(true)
  })

  it('does nothing when the save dialog is cancelled', async () => {
    saveDialog.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(exportPdf).not.toHaveBeenCalled()
  })

  it('disables Export while the preview is rendering', () => {
    previewHook.mockReturnValue(makePreviewResult({ isRendering: true }))
    render(<ExportPdfDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Choose Location & Export/ })).toBeDisabled()
  })

  it('toasts a preview error', () => {
    previewHook.mockReturnValue(makePreviewResult({ error: 'paged.js exploded' }))
    render(<ExportPdfDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)

    expect(showToast).toHaveBeenCalledWith('paged.js exploded')
  })

  it('toasts the error message on export failure and re-enables the button', async () => {
    exportPdf.mockRejectedValue(new Error('printer offline'))
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(await screen.findByRole('button', { name: /Choose Location & Export/ })).not.toBeDisabled()
    expect(showToast).toHaveBeenCalledWith('printer offline')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run ExportPdfDialog`
Expected: FAIL — the component doesn't yet accept `contentEl`, use the hook, or render three checkboxes.

- [ ] **Step 3: Rewrite the component**

```tsx
// src/components/ExportPdfDialog.tsx
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { usePrintPreview } from '../hooks/usePrintPreview'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ExportPdfDialogProps {
  noteTitle: string
  contentEl: HTMLElement | null
  onClose: () => void
}

export function ExportPdfDialog({ noteTitle, contentEl, onClose }: ExportPdfDialogProps) {
  const {
    containerRef,
    showPageNumber,
    setShowPageNumber,
    showTitle,
    setShowTitle,
    showDate,
    setShowDate,
    isRendering,
    error,
  } = usePrintPreview(contentEl, noteTitle)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    if (error) showToast(error)
  }, [error])

  async function chooseAndExport() {
    if (isExporting || isRendering) return
    const path = await save({
      defaultPath: `${noteTitle}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!path) return
    setIsExporting(true)
    try {
      await api.printing.exportPdf(path)
      showToast(`Exported "${noteTitle}.pdf"`)
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="formula-sheet-prompt print-preview-dialog" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Export to PDF</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="print-preview-checkboxes">
          <label className="print-options-checkbox">
            <input
              type="checkbox"
              checked={showPageNumber}
              onChange={(e) => setShowPageNumber(e.target.checked)}
            />
            Page numbers
          </label>
          <label className="print-options-checkbox">
            <input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} />
            Title
          </label>
          <label className="print-options-checkbox">
            <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} />
            Date
          </label>
        </div>
        <div className="print-preview-pages" ref={containerRef} />
        <div className="formula-sheet-prompt-actions">
          <button className="dialog-action" onClick={onClose}>Cancel</button>
          <button
            className="dialog-action-primary"
            onClick={() => void chooseAndExport()}
            disabled={isExporting || isRendering}
          >
            {isExporting ? 'Exporting…' : 'Choose Location & Export…'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Add the preview dialog CSS**

```css
/* src/index.css — add alongside the existing .print-dialog-row rules
   (those stay — PrintDialog's printer <select> still uses that class) */
.print-preview-dialog {
  width: min(900px, calc(100vw - 80px));
  max-height: 85vh;
}

.print-preview-checkboxes {
  display: flex;
  gap: var(--space-lg);
}

.print-preview-pages {
  overflow: auto;
  max-height: 60vh;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: var(--space-md);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run ExportPdfDialog`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ExportPdfDialog.tsx src/components/ExportPdfDialog.test.tsx src/index.css
git commit -m "feat: give Export to PDF a live paginated preview and independent field checkboxes"
```

---

## Task 7: `PrintDialog` — same treatment

**Files:**
- Modify: `src/components/PrintDialog.tsx`
- Modify: `src/components/PrintDialog.test.tsx`

**Interfaces:**
- Consumes: `usePrintPreview` (Task 3); `api.printing.printDocument(printerName: string)` (Task 5); `.print-preview-dialog`/`.print-preview-checkboxes`/`.print-preview-pages` CSS (Task 6).
- Produces: `PrintDialog({ contentEl, onClose }: { contentEl: HTMLElement | null; onClose: () => void })` — gains `contentEl`; drops nothing (it already had no `includeHeaderFooter` prop of its own, just the checkbox).

- [ ] **Step 1: Rewrite the tests**

```tsx
// src/components/PrintDialog.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrintDialog } from './PrintDialog'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { usePrintPreview } from '../hooks/usePrintPreview'

vi.mock('../lib/tauri', () => ({
  api: { printing: { listPrinters: vi.fn(), printDocument: vi.fn() } },
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))
vi.mock('../hooks/usePrintPreview', () => ({
  usePrintPreview: vi.fn(),
}))

const listPrinters = vi.mocked(api.printing.listPrinters)
const printDocument = vi.mocked(api.printing.printDocument)
const previewHook = vi.mocked(usePrintPreview)

function makePreviewResult(overrides: Partial<ReturnType<typeof usePrintPreview>> = {}) {
  return {
    containerRef: { current: null },
    showPageNumber: false,
    setShowPageNumber: vi.fn(),
    showTitle: false,
    setShowTitle: vi.fn(),
    showDate: false,
    setShowDate: vi.fn(),
    isRendering: false,
    error: null,
    ...overrides,
  }
}

beforeEach(() => {
  listPrinters.mockResolvedValue([
    { name: 'HP LaserJet', isDefault: false },
    { name: 'Microsoft Print to PDF', isDefault: true },
  ])
  printDocument.mockResolvedValue(undefined)
  previewHook.mockReturnValue(makePreviewResult())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PrintDialog', () => {
  it('preselects the default printer', async () => {
    render(<PrintDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)
    expect(await screen.findByRole('combobox')).toHaveValue('Microsoft Print to PDF')
  })

  it('prints the preselected printer', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PrintDialog noteTitle="Lecture 7" contentEl={null} onClose={onClose} />)

    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printDocument).toHaveBeenCalledWith('Microsoft Print to PDF')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders three independent checkboxes', async () => {
    render(<PrintDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)
    await screen.findByRole('combobox')
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('toasts the error message on print failure', async () => {
    printDocument.mockRejectedValue(new Error('printer offline'))
    const user = userEvent.setup()
    render(<PrintDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)

    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('printer offline'))
  })

  it('disables Print while the preview is rendering, even with a printer selected', async () => {
    previewHook.mockReturnValue(makePreviewResult({ isRendering: true }))
    render(<PrintDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Print' })).toBeDisabled()
  })

  it('disables Print when no printers are found', async () => {
    listPrinters.mockResolvedValue([])
    render(<PrintDialog noteTitle="Lecture 7" contentEl={null} onClose={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Print' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run PrintDialog`
Expected: FAIL — the component doesn't yet accept `contentEl`, use the hook, or render three checkboxes.

- [ ] **Step 3: Rewrite the component**

```tsx
// src/components/PrintDialog.tsx
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { usePrintPreview } from '../hooks/usePrintPreview'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import type { PrinterInfo } from '../types'

interface PrintDialogProps {
  noteTitle: string
  contentEl: HTMLElement | null
  onClose: () => void
}

export function PrintDialog({ noteTitle, contentEl, onClose }: PrintDialogProps) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [selected, setSelected] = useState('')
  const [isPrinting, setIsPrinting] = useState(false)
  const {
    containerRef,
    showPageNumber,
    setShowPageNumber,
    showTitle,
    setShowTitle,
    showDate,
    setShowDate,
    isRendering,
    error,
  } = usePrintPreview(contentEl, noteTitle)

  useEffect(() => {
    void api.printing.listPrinters().then((list) => {
      setPrinters(list)
      setSelected(list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? '')
    })
  }, [])

  useEffect(() => {
    if (error) showToast(error)
  }, [error])

  async function print() {
    if (isPrinting || isRendering || !selected) return
    setIsPrinting(true)
    try {
      await api.printing.printDocument(selected)
      showToast('Sent to printer')
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e))
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="formula-sheet-prompt print-preview-dialog" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Print</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <label className="print-dialog-row">
          Printer
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {printers.length === 0 && <option value="">No printers found</option>}
            {printers.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <div className="print-preview-checkboxes">
          <label className="print-options-checkbox">
            <input
              type="checkbox"
              checked={showPageNumber}
              onChange={(e) => setShowPageNumber(e.target.checked)}
            />
            Page numbers
          </label>
          <label className="print-options-checkbox">
            <input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} />
            Title
          </label>
          <label className="print-options-checkbox">
            <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} />
            Date
          </label>
        </div>
        <div className="print-preview-pages" ref={containerRef} />
        <div className="formula-sheet-prompt-actions">
          <button className="dialog-action" onClick={onClose}>Cancel</button>
          <button
            className="dialog-action-primary"
            onClick={() => void print()}
            disabled={isPrinting || isRendering || !selected}
          >
            {isPrinting ? 'Printing…' : 'Print'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

`PrintDialog` never received `noteTitle` as a prop before this task (only `ExportPdfDialog` did, via `currentNote.title`) — it now does, wired through from `Layout.tsx` in Task 8 the same way `ExportPdfDialog` already receives it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run PrintDialog`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/PrintDialog.tsx src/components/PrintDialog.test.tsx
git commit -m "feat: give Print a live paginated preview and independent field checkboxes"
```

---

## Task 8: Wire `contentEl`/`noteTitle` through `Layout.tsx`, add the print CSS exception

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `ExportPdfDialog`'s `contentEl`/`noteTitle` props, `PrintDialog`'s `contentEl`/`noteTitle` props (Tasks 6-7).

- [ ] **Step 1: Pass `contentEl`/`noteTitle` to both dialogs**

```tsx
// src/components/Layout.tsx — replace the two dialog render lines
      {activeOverlay === 'exportPdf' && currentNote && (
        <ExportPdfDialog noteTitle={currentNote.title} contentEl={editorPaneRef.current} onClose={closeOverlay} />
      )}
      {activeOverlay === 'print' && currentNote && (
        <PrintDialog noteTitle={currentNote.title} contentEl={editorPaneRef.current} onClose={closeOverlay} />
      )}
```

- [ ] **Step 2: Add the `:has()` print exception**

```css
/* src/index.css — inside the existing @media print block, replace this line: */
  [data-slot="dialog-overlay"], [data-slot="dialog-content"] { display: none !important; }

/* with: */
  [data-slot="dialog-overlay"] { display: none !important; }
  [data-slot="dialog-content"]:not(:has(.print-preview-pages)) { display: none !important; }
  [data-slot="dialog-content"]:has(.print-preview-pages) > *:not(.print-preview-pages) { display: none !important; }
```

- [ ] **Step 3: Run the full frontend test suite and typecheck**

Run: `npm run typecheck` then `npm test`
Expected: both pass — this is also where Task 5's deliberately-broken typecheck (Step 2) gets resolved, since both dialogs now call the one-argument `exportPdf`/`printDocument`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout.tsx src/index.css
git commit -m "feat: wire the print preview content/title through Layout, fix print CSS for the preview dialog"
```

---

## Task 9: Full verification pass

**Files:** none — verification only.

- [ ] **Step 1: Rust — full check**

Run, from `src-tauri/`:
```bash
cargo build
cargo test
cargo clippy -- -D warnings
cargo fmt --check
```
Expected: all clean.

- [ ] **Step 2: Frontend — full check**

```bash
npm run typecheck
npm test
```
Expected: both pass.

- [ ] **Step 3: Manual end-to-end check**

Run `npm run tauri dev`, open a note with headings, a code block, a block equation, and a diagram, then:
- `File > Export to PDF…` — confirm the preview pane shows real paginated pages; toggle each of the three checkboxes independently and confirm only that field appears/disappears in the preview (page number bottom-center, title top-left, date top-right); export and open the resulting PDF to confirm it matches the preview.
- `File > Print…` — same checks, then print to a real or virtual printer (e.g. "Microsoft Print to PDF") and confirm the physical/PDF output has exactly one Paged.js page per printed page (no rescaling, no content split across the wrong boundary).
- Confirm no Chromium print-preview chrome appears anywhere in either flow.

- [ ] **Step 4: Update the spec's Testing section if manual verification surfaces a gap**

If Step 3 finds a real discrepancy (e.g., WebView2 still rescales despite matching page sizes), record it in `docs/specs/better-printing-design.md`'s Testing section rather than silently reverting — this is exactly the kind of thing the spec already flags as unverifiable except by hand.

- [ ] **Step 5: Commit if Step 4 produced any doc changes**

```bash
git add docs/specs/better-printing-design.md
git commit -m "docs: record manual verification findings for the Paged.js print preview"
```
