# Better Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Replace P3-2's single `window.print()` File menu item with two dedicated, silent commands — Export to PDF and Print — each backed by a small dialog and a direct WebView2 COM call, plus fix two real pagination gaps in the print stylesheet.

**Architecture:** A new `src-tauri/src/commands/printing.rs` exposes three Tauri commands (`list_printers`, `export_pdf`, `print_document`) that drive WebView2's `ICoreWebView2_7::PrintToPdf` and `ICoreWebView2_16::Print` directly via `with_webview` — never `ShowPrintUI`, so the Chromium print-preview chrome never appears. Two new React dialogs (`ExportPdfDialog`, `PrintDialog`) collect a destination/printer plus one shared checkbox ("Include page numbers, date, and title") and invoke those commands. `src/index.css`'s `@media print` block gets two selector-list fixes for content that can currently be sliced across a page break.

**Tech Stack:** Rust (`windows` 0.61 Win32 bindings for `EnumPrintersW`/`GetDefaultPrinterW`, `webview2-com` 0.38 for the COM print APIs), React 19 + TypeScript, Zustand (`useOverlayManager`), Tailwind/plain CSS per `src/index.css`.

**Spec:** `docs/specs/better-printing-design.md` — read it alongside this plan; it explains *why* one checkbox covers the whole header/footer bundle and why `ShowPrintUI` is out.

## Global Constraints

- No `.unwrap()`/`.expect()` outside tests (CLAUDE.md Rust Guidelines).
- Long-running/blocking work runs in `tokio::task::spawn_blocking` (CLAUDE.md Rust Guidelines; COM/spooler calls block on `wait_with_pump`, which pumps a Win32 message loop — this must never run on the async executor).
- `cargo clippy -- -D warnings` and `cargo fmt --check` must pass locally before any push (no CI gate on `push`, per CLAUDE.md).
- Feature is Windows-only by construction (`webview2-com`, `EnumPrintersW`) — non-Windows targets get a clear error, not a silent no-op, matching the existing `#[cfg(windows)]` precedent in `src-tauri/src/lib.rs:198-215`.
- No new npm/cargo dependencies — `windows`, `webview2-com`, and `tauri-plugin-dialog` are already dependencies; only a Cargo feature flag is added.
- Command failures surface through the existing `showToast` (`src/store/toast.ts`) — no new error-display mechanism.
- Both dialogs switch the editor to wysiwyg view before the print pipeline runs, reusing the reasoning already in `Layout.tsx`'s old `export-pdf` case: the print stylesheet only styles the rendered view.

---

## File structure

- **Create** `src-tauri/src/commands/printing.rs` — `PrinterInfo` struct, the pure `mark_default` helper (unit-tested), and the three Tauri commands. One file per domain, per CLAUDE.md.
- **Modify** `src-tauri/src/commands/mod.rs` — add `pub mod printing;`.
- **Modify** `src-tauri/src/lib.rs` — register the three commands, add the `Print…` menu item.
- **Modify** `src-tauri/Cargo.toml` — add the `Win32_Graphics_Printing` feature to the `windows` dependency.
- **Modify** `src/types/index.ts` — add `PrinterInfo`.
- **Modify** `src/lib/tauri.ts` — add `api.printing`.
- **Modify** `src/hooks/useOverlayManager.ts` — add `'exportPdf' | 'print'` to `OverlayKind`.
- **Create** `src/components/ExportPdfDialog.tsx` + `ExportPdfDialog.test.tsx`.
- **Create** `src/components/PrintDialog.tsx` + `PrintDialog.test.tsx`.
- **Modify** `src/components/Layout.tsx` — replace the `window.print()`-based `export-pdf` case, add a `print` case, render both new dialogs.
- **Modify** `src/index.css` — extend the two selector lists in `@media print`, add dialog CSS.

---

## Task 1: `PrinterInfo` + `list_printers` (pure logic unit-tested, spooler call manual)

**Files:**
- Create: `src-tauri/src/commands/printing.rs`
- Modify: `src-tauri/src/commands/mod.rs`

**Interfaces:**
- Produces: `pub struct PrinterInfo { pub name: String, pub is_default: bool }` (serializes as `{ name, isDefault }`); `#[tauri::command] pub fn list_printers() -> Result<Vec<PrinterInfo>, String>`.

- [ ] **Step 1: Write the failing test for the pure helper**

```rust
// bottom of src-tauri/src/commands/printing.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_the_matching_name_as_default() {
        let printers = mark_default(vec!["A".to_string(), "B".to_string()], Some("B"));
        assert_eq!(
            printers,
            vec![
                PrinterInfo { name: "A".to_string(), is_default: false },
                PrinterInfo { name: "B".to_string(), is_default: true },
            ]
        );
    }

    #[test]
    fn no_default_when_none_matches() {
        let printers = mark_default(vec!["A".to_string()], Some("Z"));
        assert!(!printers[0].is_default);
    }

    #[test]
    fn no_default_when_none_reported() {
        let printers = mark_default(vec!["A".to_string()], None);
        assert!(!printers[0].is_default);
    }
}
```

- [ ] **Step 2: Run test to verify it fails (nothing defined yet)**

Run: `cargo test -p null-notes mark_default --manifest-path src-tauri/Cargo.toml`
Expected: FAIL to compile — `mark_default`, `PrinterInfo` not found.

- [ ] **Step 3: Write the full file**

```rust
// src-tauri/src/commands/printing.rs
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

/// Pairs enumerated printer names with which one Windows currently reports
/// as default. Pure and platform-independent on purpose — the actual
/// spooler calls below have no live printer in CI (same shape as
/// `pdf/dump.rs`'s `#[ignore]`d diagnostics), so this is the one piece of
/// this file that gets a real, always-running test.
fn mark_default(names: Vec<String>, default: Option<&str>) -> Vec<PrinterInfo> {
    names
        .into_iter()
        .map(|name| {
            let is_default = default == Some(name.as_str());
            PrinterInfo { name, is_default }
        })
        .collect()
}

#[cfg(windows)]
fn enum_printer_names() -> windows::core::Result<Vec<String>> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Printing::{EnumPrintersW, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W};

    let mut needed = 0u32;
    let mut returned = 0u32;
    unsafe {
        // Sizing call: this is expected to fail (ERROR_INSUFFICIENT_BUFFER)
        // but Windows fills `needed` with the required byte count anyway —
        // that's the documented way to size the real call's buffer.
        let _ = EnumPrintersW(PRINTER_ENUM_LOCAL, PCWSTR::null(), 4, None, &mut needed, &mut returned);
        if needed == 0 {
            return Ok(Vec::new());
        }
        let mut buf = vec![0u8; needed as usize];
        EnumPrintersW(
            PRINTER_ENUM_LOCAL,
            PCWSTR::null(),
            4,
            Some(&mut buf),
            &mut needed,
            &mut returned,
        )?;
        // `buf` holds `returned` fixed-size PRINTER_INFO_4W structs; each
        // name pointer points back into this same buffer, so the strings
        // must be copied out before `buf` drops.
        let infos = std::slice::from_raw_parts(buf.as_ptr().cast::<PRINTER_INFO_4W>(), returned as usize);
        Ok(infos
            .iter()
            .filter_map(|info| PCWSTR(info.pPrinterName.0 as *const u16).to_string().ok())
            .collect())
    }
}

#[cfg(windows)]
fn default_printer_name() -> Option<String> {
    use windows::core::PCWSTR;
    use windows::core::PWSTR;
    use windows::Win32::Graphics::Printing::GetDefaultPrinterW;

    let mut len = 0u32;
    unsafe {
        // Same sizing dance as EnumPrintersW: the first call fails but
        // reports the needed length (in wide chars, including the NUL).
        let _ = GetDefaultPrinterW(None, &mut len);
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        if !GetDefaultPrinterW(Some(PWSTR(buf.as_mut_ptr())), &mut len).as_bool() {
            return None;
        }
        PCWSTR(buf.as_ptr()).to_string().ok()
    }
}

#[tauri::command]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    #[cfg(windows)]
    {
        let names = enum_printer_names().map_err(|e| e.to_string())?;
        Ok(mark_default(names, default_printer_name().as_deref()))
    }
    #[cfg(not(windows))]
    {
        Err("Printing is only supported on Windows.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_the_matching_name_as_default() {
        let printers = mark_default(vec!["A".to_string(), "B".to_string()], Some("B"));
        assert_eq!(
            printers,
            vec![
                PrinterInfo { name: "A".to_string(), is_default: false },
                PrinterInfo { name: "B".to_string(), is_default: true },
            ]
        );
    }

    #[test]
    fn no_default_when_none_matches() {
        let printers = mark_default(vec!["A".to_string()], Some("Z"));
        assert!(!printers[0].is_default);
    }

    #[test]
    fn no_default_when_none_reported() {
        let printers = mark_default(vec!["A".to_string()], None);
        assert!(!printers[0].is_default);
    }
}
```

- [ ] **Step 4: Register the module**

```rust
// src-tauri/src/commands/mod.rs — add alphabetically
pub mod pdf;
pub mod printing;
pub mod settings;
```

- [ ] **Step 5: Add the `Win32_Graphics_Printing` Cargo feature**

```toml
# src-tauri/Cargo.toml
[target.'cfg(windows)'.dependencies]
webview2-com = "0.38"
windows = { version = "0.61", features = ["Win32_Graphics_Printing"] }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo test -p null-notes mark_default --manifest-path src-tauri/Cargo.toml`
Expected: PASS (3 tests).

- [ ] **Step 7: Verify it compiles for real (spooler calls are unverified by the test above)**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors. `enum_printer_names`/`default_printer_name`/`list_printers` are otherwise verified manually (launch the app, open the Print dialog built in Task 6, confirm real printer names appear with the right one preselected) — same posture as the PDF pipeline's `#[ignore]`d diagnostics, since CI has no installed printers.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/printing.rs src-tauri/src/commands/mod.rs src-tauri/Cargo.toml
git commit -m "feat: add list_printers command"
```

---

## Task 2: `export_pdf` command

**Files:**
- Modify: `src-tauri/src/commands/printing.rs`

**Interfaces:**
- Consumes: nothing new from Task 1 besides the file it's added to.
- Produces: `#[tauri::command] pub async fn export_pdf(app: tauri::AppHandle, path: String, include_header_footer: bool) -> Result<(), String>`.

This command has no automated test — it needs a live WebView2 instance, which CI doesn't have (same reasoning as Task 1's spooler calls). Verify manually in Task 8 once the dialog exists to trigger it from the UI.

- [ ] **Step 1: Add the WebView2 plumbing shared by export and print**

```rust
// src-tauri/src/commands/printing.rs — add below list_printers

#[cfg(windows)]
fn build_print_settings(
    core_webview: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    include_header_footer: bool,
    printer_name: Option<&str>,
) -> windows::core::Result<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PrintSettings> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_2,
    };
    use windows::core::{Interface, HSTRING};

    unsafe {
        let environment = core_webview.cast::<ICoreWebView2_2>()?.Environment()?;
        let settings = environment.cast::<ICoreWebView2Environment6>()?.CreatePrintSettings()?;
        settings.SetShouldPrintHeaderAndFooter(include_header_footer)?;
        if let Some(name) = printer_name {
            settings.cast::<ICoreWebView2PrintSettings2>()?.SetPrinterName(&HSTRING::from(name))?;
        }
        Ok(settings)
    }
}

/// Runs `f` on the webview's own COM apartment and blocks the calling
/// thread until it's done. `WebviewWindow::with_webview` only runs its
/// closure inline when called *from* the main thread — from anywhere else
/// (this is always called from inside `spawn_blocking`, i.e. a worker
/// thread) it just posts the closure to the event loop and returns
/// immediately. Without this channel, the command would report success
/// before the print/export had even started.
#[cfg(windows)]
fn run_on_main_webview<T: Send + 'static>(
    webview: &tauri::WebviewWindow,
    f: impl FnOnce(webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2) -> Result<T, String>
        + Send
        + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform_webview| {
            let outcome = unsafe { platform_webview.controller().CoreWebView2() }
                .map_err(|e| e.to_string())
                .and_then(f);
            let _ = tx.send(outcome);
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|_| "the print operation never completed".to_string())?
}
```

- [ ] **Step 2: Add `export_pdf`**

```rust
// src-tauri/src/commands/printing.rs — add below the plumbing above

#[cfg(windows)]
fn export_pdf_sync(
    app: &tauri::AppHandle,
    path: String,
    include_header_footer: bool,
) -> Result<(), String> {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_7;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let webview = app.get_webview_window("main").ok_or("main window not found")?;
    run_on_main_webview(&webview, move |core_webview| unsafe {
        let settings = build_print_settings(&core_webview, include_header_footer, None)
            .map_err(|e| e.to_string())?;
        let core_webview_7 = core_webview.cast::<ICoreWebView2_7>().map_err(|e| e.to_string())?;
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
pub async fn export_pdf(
    app: tauri::AppHandle,
    path: String,
    include_header_footer: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(move || export_pdf_sync(&app, path, include_header_footer))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("Printing is only supported on Windows.".to_string())
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors. If a COM signature doesn't line up exactly (interface version, argument order), the compiler error will name the mismatched method — fix against `webview2-com-sys`'s generated bindings for the exact signature (search your local `~/.cargo/registry/src/*/webview2-com-sys-0.38.2/src/bindings.rs` for the method name).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/printing.rs
git commit -m "feat: add export_pdf command using WebView2's silent PrintToPdf"
```

---

## Task 3: `print_document` command

**Files:**
- Modify: `src-tauri/src/commands/printing.rs`

**Interfaces:**
- Consumes: `build_print_settings`, `run_on_main_webview` from Task 2.
- Produces: `#[tauri::command] pub async fn print_document(app: tauri::AppHandle, printer_name: String, include_header_footer: bool) -> Result<(), String>`.

Same testing posture as Task 2 — no live printer/webview in CI, verified manually once the dialog exists (Task 8).

- [ ] **Step 1: Add `print_document`**

```rust
// src-tauri/src/commands/printing.rs — add below export_pdf

#[cfg(windows)]
fn print_document_sync(
    app: &tauri::AppHandle,
    printer_name: String,
    include_header_footer: bool,
) -> Result<(), String> {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PRINT_STATUS, COREWEBVIEW2_PRINT_STATUS_SUCCEEDED, ICoreWebView2_16,
    };
    use webview2_com::PrintCompletedHandler;
    use windows::core::Interface;

    let webview = app.get_webview_window("main").ok_or("main window not found")?;
    run_on_main_webview(&webview, move |core_webview| unsafe {
        let settings = build_print_settings(&core_webview, include_header_footer, Some(&printer_name))
            .map_err(|e| e.to_string())?;
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
pub async fn print_document(
    app: tauri::AppHandle,
    printer_name: String,
    include_header_footer: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(move || print_document_sync(&app, printer_name, include_header_footer))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("Printing is only supported on Windows.".to_string())
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors (same caveat as Task 2 Step 3 if a signature is off).

- [ ] **Step 3: Run clippy and fmt on the whole new file**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` and `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
Expected: both clean. Run `cargo fmt --manifest-path src-tauri/Cargo.toml` first if the check fails.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/printing.rs
git commit -m "feat: add print_document command using WebView2's silent Print"
```

---

## Task 4: Wire the three commands into `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `commands::printing::list_printers`, `commands::printing::export_pdf`, `commands::printing::print_document` (Tasks 1-3).

- [ ] **Step 1: Add the `Print…` menu item**

```rust
// src-tauri/src/lib.rs — file_menu, replacing the export-pdf line and its trailing separator
            &MenuItem::with_id(handle, "export-pdf", "Export to PDF…", true, None::<&str>)?,
            &MenuItem::with_id(handle, "print", "Print…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
```

- [ ] **Step 2: Register the commands**

```rust
// src-tauri/src/lib.rs — invoke_handler, after commands::window::confirm_close,
            commands::window::confirm_close,
            commands::printing::list_printers,
            commands::printing::export_pdf,
            commands::printing::print_document,
        ])
```

- [ ] **Step 3: Verify it builds**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add Print menu item and register printing commands"
```

---

## Task 5: Frontend types + `api.printing` + overlay kind

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/hooks/useOverlayManager.ts`

**Interfaces:**
- Produces: `PrinterInfo` type; `api.printing.listPrinters()`, `api.printing.exportPdf(path, includeHeaderFooter)`, `api.printing.printDocument(printerName, includeHeaderFooter)`; `OverlayKind` gains `'exportPdf' | 'print'`.

- [ ] **Step 1: Add the `PrinterInfo` type**

```ts
// src/types/index.ts — append at end of file
export interface PrinterInfo {
  name: string
  isDefault: boolean
}
```

- [ ] **Step 2: Add `api.printing`**

```ts
// src/lib/tauri.ts — add PrinterInfo to the type import on line 2
import type { NoteMetadata, WorkspaceState, WorkspaceTree, SearchResult, AppSettings, GraphLink, GraphTag, RepoMode, CommitOutcome, PushOutcome, PullOutcome, RepoInitOutcome, TemplateMetadata, CrossRefTarget, OpenTask, DueCard, Grade, NoteHistoryEntry, BacklinkEntry, PrinterInfo } from '../types'
```

```ts
// src/lib/tauri.ts — new top-level key on the `api` object, after `codeRun`
  printing: {
    listPrinters: () =>
      invoke<PrinterInfo[]>('list_printers'),
    exportPdf: (path: string, includeHeaderFooter: boolean) =>
      invoke<void>('export_pdf', { path, includeHeaderFooter }),
    printDocument: (printerName: string, includeHeaderFooter: boolean) =>
      invoke<void>('print_document', { printerName, includeHeaderFooter }),
  },
```

- [ ] **Step 3: Add the overlay kinds**

```ts
// src/hooks/useOverlayManager.ts
export type OverlayKind =
  | 'search'
  | 'switcher'
  | 'settings'
  | 'shortcuts'
  | 'template'
  | 'graph'
  | 'task'
  | 'review'
  | 'formulaSheet'
  | 'exportPdf'
  | 'print'
```

- [ ] **Step 4: Verify the types check**

Run: `npm run typecheck`
Expected: passes (nothing consumes the new API yet, but nothing should break either).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/tauri.ts src/hooks/useOverlayManager.ts
git commit -m "feat: add printing types, api client, and overlay kinds"
```

---

## Task 6: `ExportPdfDialog`

**Files:**
- Create: `src/components/ExportPdfDialog.tsx`
- Create: `src/components/ExportPdfDialog.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `api.printing.exportPdf` (Task 5), `showToast` (`src/store/toast.ts`), `save` from `@tauri-apps/plugin-dialog`.
- Produces: `ExportPdfDialog({ noteTitle, onClose }: { noteTitle: string; onClose: () => void })`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/ExportPdfDialog.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPdfDialog } from './ExportPdfDialog'
import { api } from '../lib/tauri'
import { save } from '@tauri-apps/plugin-dialog'
import { showToast } from '../store/toast'

vi.mock('../lib/tauri', () => ({
  api: { printing: { exportPdf: vi.fn() } },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

const exportPdf = vi.mocked(api.printing.exportPdf)
const saveDialog = vi.mocked(save)

beforeEach(() => {
  saveDialog.mockResolvedValue('C:\\notes\\Lecture 7.pdf')
  exportPdf.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ExportPdfDialog', () => {
  it('exports with the checkbox off by default', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportPdfDialog noteTitle="Lecture 7" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(saveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'Lecture 7.pdf' }))
    expect(exportPdf).toHaveBeenCalledWith('C:\\notes\\Lecture 7.pdf', false)
    expect(onClose).toHaveBeenCalled()
  })

  it('passes the checkbox state through when checked', async () => {
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" onClose={vi.fn()} />)

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(exportPdf).toHaveBeenCalledWith('C:\\notes\\Lecture 7.pdf', true)
  })

  it('does nothing when the save dialog is cancelled', async () => {
    saveDialog.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(exportPdf).not.toHaveBeenCalled()
  })

  it('toasts the error message on failure and re-enables the button', async () => {
    exportPdf.mockRejectedValue(new Error('printer offline'))
    const user = userEvent.setup()
    render(<ExportPdfDialog noteTitle="Lecture 7" onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /Choose Location & Export/ }))

    expect(await screen.findByRole('button', { name: /Choose Location & Export/ })).not.toBeDisabled()
    expect(showToast).toHaveBeenCalledWith('printer offline')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ExportPdfDialog`
Expected: FAIL — `./ExportPdfDialog` doesn't exist yet.

- [ ] **Step 3: Write the component**

```tsx
// src/components/ExportPdfDialog.tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ExportPdfDialogProps {
  noteTitle: string
  onClose: () => void
}

export function ExportPdfDialog({ noteTitle, onClose }: ExportPdfDialogProps) {
  const [includeHeaderFooter, setIncludeHeaderFooter] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  async function chooseAndExport() {
    if (isExporting) return
    const path = await save({
      defaultPath: `${noteTitle}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!path) return
    setIsExporting(true)
    try {
      await api.printing.exportPdf(path, includeHeaderFooter)
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
      <DialogContent className="formula-sheet-prompt export-pdf-dialog" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Export to PDF</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <label className="print-options-checkbox">
          <input
            type="checkbox"
            checked={includeHeaderFooter}
            onChange={(e) => setIncludeHeaderFooter(e.target.checked)}
          />
          Include page numbers, date, and title
        </label>
        <div className="formula-sheet-prompt-actions">
          <button className="dialog-action" onClick={onClose}>Cancel</button>
          <button className="dialog-action-primary" onClick={() => void chooseAndExport()} disabled={isExporting}>
            {isExporting ? 'Exporting…' : 'Choose Location & Export…'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Add the shared checkbox-row CSS**

```css
/* src/index.css — near .formula-sheet-prompt-actions (~line 3614) */
.print-options-checkbox {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 13px;
  color: var(--text-secondary);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- ExportPdfDialog`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ExportPdfDialog.tsx src/components/ExportPdfDialog.test.tsx src/index.css
git commit -m "feat: add Export to PDF dialog"
```

---

## Task 7: `PrintDialog`

**Files:**
- Create: `src/components/PrintDialog.tsx`
- Create: `src/components/PrintDialog.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `api.printing.listPrinters`, `api.printing.printDocument` (Task 5), `showToast`, `.print-options-checkbox` CSS (Task 6).
- Produces: `PrintDialog({ onClose }: { onClose: () => void })`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/PrintDialog.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrintDialog } from './PrintDialog'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'

vi.mock('../lib/tauri', () => ({
  api: { printing: { listPrinters: vi.fn(), printDocument: vi.fn() } },
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

const listPrinters = vi.mocked(api.printing.listPrinters)
const printDocument = vi.mocked(api.printing.printDocument)

beforeEach(() => {
  listPrinters.mockResolvedValue([
    { name: 'HP LaserJet', isDefault: false },
    { name: 'Microsoft Print to PDF', isDefault: true },
  ])
  printDocument.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PrintDialog', () => {
  it('preselects the default printer', async () => {
    render(<PrintDialog onClose={vi.fn()} />)
    expect(await screen.findByRole('combobox')).toHaveValue('Microsoft Print to PDF')
  })

  it('prints the preselected printer with the checkbox off by default', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PrintDialog onClose={onClose} />)

    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printDocument).toHaveBeenCalledWith('Microsoft Print to PDF', false)
    expect(onClose).toHaveBeenCalled()
  })

  it('prints whichever printer is chosen from the select', async () => {
    const user = userEvent.setup()
    render(<PrintDialog onClose={vi.fn()} />)

    await user.selectOptions(await screen.findByRole('combobox'), 'HP LaserJet')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printDocument).toHaveBeenCalledWith('HP LaserJet', false)
  })

  it('toasts the error message on failure', async () => {
    printDocument.mockRejectedValue(new Error('printer offline'))
    const user = userEvent.setup()
    render(<PrintDialog onClose={vi.fn()} />)

    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('printer offline'))
  })

  it('disables Print when no printers are found', async () => {
    listPrinters.mockResolvedValue([])
    render(<PrintDialog onClose={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Print' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- PrintDialog`
Expected: FAIL — `./PrintDialog` doesn't exist yet.

- [ ] **Step 3: Write the component**

```tsx
// src/components/PrintDialog.tsx
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import type { PrinterInfo } from '../types'

interface PrintDialogProps {
  onClose: () => void
}

export function PrintDialog({ onClose }: PrintDialogProps) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [selected, setSelected] = useState('')
  const [includeHeaderFooter, setIncludeHeaderFooter] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)

  useEffect(() => {
    void api.printing.listPrinters().then((list) => {
      setPrinters(list)
      setSelected(list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? '')
    })
  }, [])

  async function print() {
    if (isPrinting || !selected) return
    setIsPrinting(true)
    try {
      await api.printing.printDocument(selected, includeHeaderFooter)
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
      <DialogContent className="formula-sheet-prompt print-dialog" showCloseButton={false}>
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
        <label className="print-options-checkbox">
          <input
            type="checkbox"
            checked={includeHeaderFooter}
            onChange={(e) => setIncludeHeaderFooter(e.target.checked)}
          />
          Include page numbers, date, and title
        </label>
        <div className="formula-sheet-prompt-actions">
          <button className="dialog-action" onClick={onClose}>Cancel</button>
          <button className="dialog-action-primary" onClick={() => void print()} disabled={isPrinting || !selected}>
            {isPrinting ? 'Printing…' : 'Print'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Add the printer-select CSS**

```css
/* src/index.css — next to .print-options-checkbox */
.print-dialog-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: 13px;
  color: var(--text-secondary);
}

.print-dialog-row select {
  padding: 8px 10px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 14px;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- PrintDialog`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/PrintDialog.tsx src/components/PrintDialog.test.tsx src/index.css
git commit -m "feat: add Print dialog"
```

---

## Task 8: Wire both dialogs into `Layout.tsx`

**Files:**
- Modify: `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `ExportPdfDialog`, `PrintDialog` (Tasks 6-7); `'exportPdf' | 'print'` overlay kinds (Task 5).

- [ ] **Step 1: Import the two dialogs**

```tsx
// src/components/Layout.tsx — with the other overlay imports
import { FormulaSheetPrompt } from './FormulaSheetPrompt'
import { ExportPdfDialog } from './ExportPdfDialog'
import { PrintDialog } from './PrintDialog'
```

- [ ] **Step 2: Replace the `export-pdf` case and add `print`**

```tsx
// src/components/Layout.tsx — replace the existing 'export-pdf' case (lines 168-179)
        case 'export-pdf':
          if (!activeTab) break
          // The print stylesheet only styles the rendered view — switch
          // before the dialog opens so it's already correct by the time
          // the user clicks Export.
          setViewMode('wysiwyg')
          openOverlay('exportPdf')
          break
        case 'print':
          if (!activeTab) break
          setViewMode('wysiwyg')
          openOverlay('print')
          break
```

- [ ] **Step 3: Render both dialogs**

```tsx
// src/components/Layout.tsx — with the other activeOverlay === '...' lines
      {activeOverlay === 'formulaSheet' && <FormulaSheetPrompt onClose={closeOverlay} />}
      {activeOverlay === 'exportPdf' && currentNote && (
        <ExportPdfDialog noteTitle={currentNote.title} onClose={closeOverlay} />
      )}
      {activeOverlay === 'print' && <PrintDialog onClose={closeOverlay} />}
```

- [ ] **Step 4: Run the existing Layout tests to confirm nothing broke**

Run: `npm test -- Layout`
Expected: PASS — no existing test exercises `export-pdf`/`print`, so this is a regression check, not new coverage.

- [ ] **Step 5: Run the full frontend test suite and typecheck**

Run: `npm test` then `npm run typecheck`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.tsx
git commit -m "feat: wire Export to PDF and Print dialogs into the File menu"
```

---

## Task 9: Pagination fixes in `@media print`

**Files:**
- Modify: `src/index.css`

**Interfaces:** none — pure CSS.

This is the one change with no automated test (CSS `break-inside`/`break-after` behavior isn't meaningfully unit-testable per the spec's Testing section) — verify visually via the `ui-preview` skill or the app's own print preview.

- [ ] **Step 1: Extend the heading break-after list**

```css
/* src/index.css line 3665 — was: .note-editor h1, .note-editor h2, .note-editor h3 { break-after: avoid; } */
  .note-editor h1, .note-editor h2, .note-editor h3, .note-editor h4, .note-editor h5, .note-editor h6 { break-after: avoid; }
```

- [ ] **Step 2: Extend the break-inside list to cover maths and diagrams**

```css
/* src/index.css lines 3666-3669 — was:
  .note-editor pre, .pdf-page-block, .ink-block-wrapper, .note-editor table,
  .note-image, .callout, .details-wrapper {
    break-inside: avoid;
  } */
  .note-editor pre, .pdf-page-block, .ink-block-wrapper, .note-editor table,
  .note-image, .callout, .details-wrapper, .block-math, .mermaid-block,
  .diagram-block-preview {
    break-inside: avoid;
  }
```

- [ ] **Step 3: Verify visually**

Use the `ui-preview` skill against a note containing an `h4`/`h5`/`h6` heading, a block equation (`.block-math`), and a Mermaid diagram (`.mermaid-block`) placed near where a page break would fall, and confirm none of them split across pages in the browser's print preview (`Ctrl+P` in the dev-server tab, or the OS print preview once built).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "fix: keep headings, equations, and diagrams from splitting across a printed page"
```

---

## Task 10: Full verification pass

**Files:** none — verification only.

- [ ] **Step 1: Rust — full check**

Run, from `src-tauri/`:
```bash
cargo build
cargo test
cargo clippy -- -D warnings
cargo fmt --check
```
Expected: all clean. Fix any drift with `cargo fmt` before re-running `--check`.

- [ ] **Step 2: Frontend — full check**

```bash
npm run typecheck
npm test
```
Expected: both pass.

- [ ] **Step 3: Manual end-to-end check (COM code CI cannot exercise)**

Run `npm run tauri dev`, open a note with a mix of content (heading levels, a code block, a block equation, ink, a diagram), then:
- `File > Export to PDF…` with the checkbox off, then on — open both resulting PDFs and confirm the header/footer bundle only appears when checked, and the OS Save dialog (not Chromium's print-preview UI) is the only dialog shown.
- `File > Print…` — confirm the printer list shows real installed printers with the correct one preselected, and that printing (e.g. to "Microsoft Print to PDF") goes straight through with no Chromium print-preview UI.
- Confirm toggling the raw/source view before either action still exports/prints the rendered view, not raw markdown.

- [ ] **Step 4: Update TODO.md**

```markdown
<!-- TODO.md — change from `- [ ] Better printing` to: -->
- [x] Better printing — Export to PDF and Print are now separate File menu items, each a small dialog ending in a silent WebView2 call (`PrintToPdf`/`Print`, never `ShowPrintUI`). One checkbox ("Include page numbers, date, and title") controls WebView2's all-or-nothing header/footer bundle. Fixed two real pagination gaps (`h4`-`h6` and block-math/diagrams could split across a page). **Design:** `docs/specs/better-printing-design.md`. **Plan:** `docs/plans/better-printing.md`.
```

- [ ] **Step 5: Commit**

```bash
git add TODO.md
git commit -m "docs: mark Better printing done in TODO.md"
```
