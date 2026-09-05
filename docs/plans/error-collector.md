# Error Collector Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Persist every error the live app hits — Rust panics, JS crashes, and `console.error` calls — to a machine-local log file, with a small in-app dialog to view and clear it.

**Architecture:** A single Rust command module (`error_log.rs`) appends JSON-lines entries to `errors.log` in the app-data dir and serves them back; a Rust panic hook writes to the same file synchronously. The frontend funnels three capture sources (`window.onerror`/`unhandledrejection`, a React error boundary, a wrapped `console.error`) through one `logError()` helper that calls the Rust command. A new dialog, opened from Settings, lists and clears the log.

**Tech Stack:** Rust (tauri command, `chrono` for timestamps, `tokio::fs` — all already in the project), React 19 + TypeScript, Zustand-free (local component state is enough for the dialog).

**Spec:** `docs/specs/error-collector-design.md`

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Rust: never `.unwrap()`/`.expect()` outside tests; commands return `Result<T, String>` via `.map_err(|e| e.to_string())`; internal functions return `anyhow::Result`; derive `Debug` on structs; `cargo clippy -- -D warnings` and `cargo fmt --check` must stay clean.
- Rust structs that cross the IPC boundary use `#[serde(rename_all = "camelCase")]` (every existing struct in `models.rs` does).
- TypeScript strict mode: no `any`, no non-null `!` assertions, no implicit `any`.
- React: functional components only, **except** `ErrorBoundary`, which must be a class component — `componentDidCatch`/`getDerivedStateFromError` have no functional-component equivalent in React 19. This is the one deliberate exception, called out in the spec.
- Storage boundary (`CLAUDE.md`): `errors.log` lives in the OS app-data dir (`app.path().app_data_dir()`), the same home as `settings.json` — never inside the workspace.
- No new dependencies: `chrono` (with `clock` feature), `tokio`, `serde_json`, `tempfile` are already in `src-tauri/Cargo.toml`.

---

### Task 1: Rust error log storage, commands, and panic hook

**Files:**
- Modify: `src-tauri/src/models.rs` — add `ErrorEntry` struct
- Create: `src-tauri/src/commands/error_log.rs`
- Modify: `src-tauri/src/commands/mod.rs` — add `pub mod error_log;`
- Modify: `src-tauri/src/lib.rs` — register the three commands, install the panic hook

**Interfaces:**
- Produces: `ErrorEntry { timestamp: String, source: String, message: String, context: Option<String> }` (in `models.rs`)
- Produces: `record_error(app: AppHandle, source: String, message: String, context: Option<String>) -> Result<(), String>`
- Produces: `list_errors(app: AppHandle) -> Result<Vec<ErrorEntry>, String>` (newest first, capped at 200)
- Produces: `clear_errors(app: AppHandle) -> Result<(), String>`
- Produces: `pub fn append_entry_sync(dir: &Path, source: &str, message: &str, context: Option<&str>)` — used only by the panic hook, since a hook has no `AppHandle` and must not be async

- [ ] **Step 1: Add the `ErrorEntry` struct**

In `src-tauri/src/models.rs`, add near the other IPC structs:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEntry {
    pub timestamp: String,
    pub source: String,
    pub message: String,
    pub context: Option<String>,
}
```

- [ ] **Step 2: Write the failing tests for the storage functions**

Create `src-tauri/src/commands/error_log.rs`:

```rust
use crate::models::ErrorEntry;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

const ERROR_LOG_FILE: &str = "errors.log";

async fn append_entry_to_dir(dir: &Path, entry: &ErrorEntry) -> anyhow::Result<()> {
    todo!()
}

async fn read_entries_from_dir(dir: &Path, limit: usize) -> anyhow::Result<Vec<ErrorEntry>> {
    todo!()
}

async fn clear_entries_in_dir(dir: &Path) -> anyhow::Result<()> {
    todo!()
}

/// Synchronous, best-effort variant for the panic hook (Step 4 of this task):
/// a hook has no `AppHandle` to ask for the app-data dir, no guarantee the
/// tokio runtime is still reachable, and must never itself panic.
pub fn append_entry_sync(_dir: &Path, _source: &str, _message: &str, _context: Option<&str>) {
    todo!()
}

#[tauri::command]
pub async fn record_error(
    app: AppHandle,
    source: String,
    message: String,
    context: Option<String>,
) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let entry = ErrorEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        source,
        message,
        context,
    };
    append_entry_to_dir(&dir, &entry)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_errors(app: AppHandle) -> Result<Vec<ErrorEntry>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    read_entries_from_dir(&dir, 200)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_errors(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    clear_entries_in_dir(&dir).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_entry(source: &str) -> ErrorEntry {
        ErrorEntry {
            timestamp: "2026-09-05T00:00:00Z".to_string(),
            source: source.to_string(),
            message: "boom".to_string(),
            context: None,
        }
    }

    #[tokio::test]
    async fn test_append_and_read_roundtrip() {
        let dir = tempdir().unwrap();
        append_entry_to_dir(dir.path(), &sample_entry("console-error"))
            .await
            .unwrap();

        let entries = read_entries_from_dir(dir.path(), 200).await.unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "console-error");
        assert_eq!(entries[0].message, "boom");
    }

    #[tokio::test]
    async fn test_read_missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let entries = read_entries_from_dir(dir.path(), 200).await.unwrap();
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn test_read_caps_at_limit_and_returns_newest_first() {
        let dir = tempdir().unwrap();
        for i in 0..5 {
            append_entry_to_dir(dir.path(), &sample_entry(&format!("source-{i}")))
                .await
                .unwrap();
        }

        let entries = read_entries_from_dir(dir.path(), 3).await.unwrap();

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].source, "source-4");
        assert_eq!(entries[1].source, "source-3");
        assert_eq!(entries[2].source, "source-2");
    }

    #[tokio::test]
    async fn test_clear_empties_the_log() {
        let dir = tempdir().unwrap();
        append_entry_to_dir(dir.path(), &sample_entry("console-error"))
            .await
            .unwrap();

        clear_entries_in_dir(dir.path()).await.unwrap();

        let entries = read_entries_from_dir(dir.path(), 200).await.unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_append_entry_sync_writes_a_readable_line() {
        let dir = tempdir().unwrap();
        append_entry_sync(dir.path(), "panic", "index out of bounds", None);

        let content = std::fs::read_to_string(dir.path().join(ERROR_LOG_FILE)).unwrap();
        assert!(content.contains("index out of bounds"));
        assert!(content.contains("\"source\":\"panic\""));
    }
}
```

Add the module to `src-tauri/src/commands/mod.rs`:

```rust
pub mod error_log;
```

(insert alphabetically, between `editor_launch` and `git`)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test error_log --manifest-path src-tauri/Cargo.toml`
Expected: FAIL — `todo!()` panics inside `append_entry_to_dir` etc.

- [ ] **Step 4: Implement the storage functions**

Replace the four `todo!()` bodies in `src-tauri/src/commands/error_log.rs`:

```rust
async fn append_entry_to_dir(dir: &Path, entry: &ErrorEntry) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dir).await?;
    let mut line = serde_json::to_string(entry)?;
    line.push('\n');
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(ERROR_LOG_FILE))
        .await?;
    file.write_all(line.as_bytes()).await?;
    Ok(())
}

async fn read_entries_from_dir(dir: &Path, limit: usize) -> anyhow::Result<Vec<ErrorEntry>> {
    let file = dir.join(ERROR_LOG_FILE);
    if !file.exists() {
        return Ok(Vec::new());
    }
    let content = tokio::fs::read_to_string(&file).await?;
    let mut entries: Vec<ErrorEntry> = content
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    entries.reverse();
    entries.truncate(limit);
    Ok(entries)
}

async fn clear_entries_in_dir(dir: &Path) -> anyhow::Result<()> {
    let file = dir.join(ERROR_LOG_FILE);
    if file.exists() {
        tokio::fs::write(&file, "").await?;
    }
    Ok(())
}

pub fn append_entry_sync(dir: &Path, source: &str, message: &str, context: Option<&str>) {
    let entry = ErrorEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        source: source.to_string(),
        message: message.to_string(),
        context: context.map(|c| c.to_string()),
    };
    let Ok(mut line) = serde_json::to_string(&entry) else {
        return;
    };
    line.push('\n');
    let _ = std::fs::create_dir_all(dir);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(ERROR_LOG_FILE))
    {
        use std::io::Write;
        let _ = file.write_all(line.as_bytes());
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test error_log --manifest-path src-tauri/Cargo.toml`
Expected: PASS (5 tests)

- [ ] **Step 6: Register the commands and the panic hook**

In `src-tauri/src/lib.rs`, add near the top (after the existing `use` lines):

```rust
use std::path::PathBuf;
use std::sync::OnceLock;

static ERROR_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
```

Inside `.setup(move |app| { ... })`, right after `let data_dir = app.path().app_data_dir()?;`:

```rust
let _ = ERROR_LOG_DIR.set(data_dir.clone());
std::panic::set_hook(Box::new(|info| {
    if let Some(dir) = ERROR_LOG_DIR.get() {
        commands::error_log::append_entry_sync(dir, "panic", &info.to_string(), None);
    }
}));
```

In the `tauri::generate_handler![...]` list, add (alphabetically near `settings`):

```rust
commands::error_log::record_error,
commands::error_log::list_errors,
commands::error_log::clear_errors,
```

- [ ] **Step 7: Verify the build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean, no warnings

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
Expected: clean

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands/error_log.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add error log storage, commands, and panic hook"
```

---

### Task 2: Frontend API layer and `logError` helper

**Files:**
- Modify: `src/types/index.ts` — add `ErrorLogEntry`
- Modify: `src/lib/tauri.ts` — add `api.errorLog`
- Create: `src/lib/errorLog.ts`
- Test: `src/lib/errorLog.test.ts`

**Interfaces:**
- Consumes: `record_error`, `list_errors`, `clear_errors` Tauri commands (Task 1)
- Produces: `ErrorLogEntry { timestamp: string; source: string; message: string; context: string | null }`
- Produces: `api.errorLog.record(source: string, message: string, context: string | null): Promise<void>`
- Produces: `api.errorLog.list(): Promise<ErrorLogEntry[]>`
- Produces: `api.errorLog.clear(): Promise<void>`
- Produces: `logError(source: string, message: string, context?: string): void` — fire-and-forget, never throws

- [ ] **Step 1: Add the `ErrorLogEntry` type**

In `src/types/index.ts`, add near `AppSettings`:

```ts
export interface ErrorLogEntry {
  timestamp: string
  source: string
  message: string
  context: string | null
}
```

- [ ] **Step 2: Add the `errorLog` namespace to the API**

In `src/lib/tauri.ts`, add `ErrorLogEntry` to the existing type-only import from `'../types'`, then add a new top-level key on `api` (next to `settings`):

```ts
  errorLog: {
    record: (source: string, message: string, context: string | null) =>
      invoke<void>('record_error', { source, message, context }),
    list: () =>
      invoke<ErrorLogEntry[]>('list_errors'),
    clear: () =>
      invoke<void>('clear_errors'),
  },
```

- [ ] **Step 3: Write the failing test for `logError`**

Create `src/lib/errorLog.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { api } from './tauri'

vi.mock('./tauri', () => ({
  api: { errorLog: { record: vi.fn() } },
}))

const record = vi.mocked(api.errorLog.record)

describe('logError', () => {
  it('forwards source, message, and context to api.errorLog.record', async () => {
    const { logError } = await import('./errorLog')
    record.mockResolvedValueOnce(undefined)

    logError('console-error', 'boom', 'at foo.ts:1')

    expect(record).toHaveBeenCalledWith('console-error', 'boom', 'at foo.ts:1')
  })

  it('defaults context to null when omitted', async () => {
    const { logError } = await import('./errorLog')
    record.mockResolvedValueOnce(undefined)

    logError('window-error', 'boom')

    expect(record).toHaveBeenCalledWith('window-error', 'boom', null)
  })

  it('never throws when the underlying invoke rejects', async () => {
    const { logError } = await import('./errorLog')
    record.mockRejectedValueOnce(new Error('ipc down'))

    expect(() => logError('console-error', 'boom')).not.toThrow()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/lib/errorLog.test.ts`
Expected: FAIL — `./errorLog` does not exist

- [ ] **Step 5: Implement `logError`**

Create `src/lib/errorLog.ts`:

```ts
import { api } from './tauri'

export function logError(source: string, message: string, context?: string): void {
  void api.errorLog.record(source, message, context ?? null).catch(() => {})
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/lib/errorLog.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/lib/tauri.ts src/lib/errorLog.ts src/lib/errorLog.test.ts
git commit -m "feat: add error log API bindings and logError helper"
```

---

### Task 3: Wire window/console capture in `main.tsx`

**Files:**
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `logError` (Task 2)

No new test file: `main.tsx` is the app entry point with no existing test harness, and its whole job here is wiring three browser globals together — the wiring itself is exercised by Task 2's `logError` tests plus a manual smoke check.

- [ ] **Step 1: Add the listeners and the `console.error` wrap**

Modify `src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import './index.css'
import 'katex/dist/katex.min.css'
import '@xterm/xterm/css/xterm.css'
import App from "./App";
import { logError } from "./lib/errorLog";

window.addEventListener('error', (event) => {
  logError('window-error', event.message, event.error instanceof Error ? event.error.stack : undefined)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  logError('unhandled-rejection', message, stack)
})

const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  logError('console-error', args.map(String).join(' '))
  originalConsoleError(...args)
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2: Manual smoke check**

Run: `npm run dev`, open devtools console, run `console.error('test')` and `Promise.reject(new Error('test'))` in the console, confirm no exceptions bubble up and the app keeps running. (The written record isn't visible yet — Task 5 adds the viewer.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx
git commit -m "feat: capture window errors, rejections, and console.error"
```

---

### Task 4: `ErrorBoundary` component

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Test: `src/components/ErrorBoundary.test.tsx`
- Modify: `src/main.tsx` — wrap `<App />`

**Interfaces:**
- Consumes: `logError` (Task 2)
- Produces: `ErrorBoundary` (React component, class-based — see Global Constraints)

- [ ] **Step 1: Write the failing test**

Create `src/components/ErrorBoundary.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

vi.mock('../lib/errorLog', () => ({ logError: vi.fn() }))
import { logError } from '../lib/errorLog'

afterEach(() => cleanup())

function Boom(): never {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('renders a fallback and logs when a child throws', () => {
    // React logs the error to the console by default during this render;
    // that's expected noise, not a test failure.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      'react-boundary',
      'kaboom',
      expect.anything(),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ErrorBoundary.test.tsx`
Expected: FAIL — `./ErrorBoundary` does not exist

- [ ] **Step 3: Implement `ErrorBoundary`**

Create `src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logError } from '../lib/errorLog'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError('react-boundary', error.message, info.componentStack ?? undefined)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <p>Something went wrong. Try reloading the app.</p>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/ErrorBoundary.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Wrap `<App />` in `main.tsx`**

```tsx
import { ErrorBoundary } from "./components/ErrorBoundary";

// ...

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/components/ErrorBoundary.tsx src/components/ErrorBoundary.test.tsx src/main.tsx
git commit -m "feat: add ErrorBoundary around the app shell"
```

---

### Task 5: `ErrorLogDialog` viewer and Settings entry point

**Files:**
- Create: `src/components/ErrorLogDialog.tsx`
- Test: `src/components/ErrorLogDialog.test.tsx`
- Modify: `src/components/SettingsPanel.tsx` — add a "View error log" button and dialog toggle

**Interfaces:**
- Consumes: `api.errorLog.list()`, `api.errorLog.clear()` (Task 2), `Dialog`/`DialogContent`/`DialogTitle` (`src/components/ui/dialog.tsx`)
- Produces: `ErrorLogDialog({ onClose: () => void })`

- [ ] **Step 1: Write the failing test**

Create `src/components/ErrorLogDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorLogDialog } from './ErrorLogDialog'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { errorLog: { list: vi.fn(), clear: vi.fn() } },
}))

const list = vi.mocked(api.errorLog.list)
const clear = vi.mocked(api.errorLog.clear)

afterEach(() => cleanup())

describe('ErrorLogDialog', () => {
  it('shows an empty state when there are no entries', async () => {
    list.mockResolvedValueOnce([])
    render(<ErrorLogDialog onClose={vi.fn()} />)

    expect(await screen.findByText(/no errors recorded/i)).toBeInTheDocument()
  })

  it('lists fetched entries', async () => {
    list.mockResolvedValueOnce([
      { timestamp: '2026-09-05T00:00:00Z', source: 'panic', message: 'boom', context: null },
    ])
    render(<ErrorLogDialog onClose={vi.fn()} />)

    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(screen.getByText('panic')).toBeInTheDocument()
  })

  it('clears the log and empties the list on Clear', async () => {
    const user = userEvent.setup()
    list.mockResolvedValueOnce([
      { timestamp: '2026-09-05T00:00:00Z', source: 'panic', message: 'boom', context: null },
    ])
    clear.mockResolvedValueOnce(undefined)
    render(<ErrorLogDialog onClose={vi.fn()} />)
    await screen.findByText('boom')

    await user.click(screen.getByRole('button', { name: /clear log/i }))

    await waitFor(() => expect(screen.queryByText('boom')).toBeNull())
    expect(clear).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ErrorLogDialog.test.tsx`
Expected: FAIL — `./ErrorLogDialog` does not exist

- [ ] **Step 3: Implement `ErrorLogDialog`**

Create `src/components/ErrorLogDialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import type { ErrorLogEntry } from '../types'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ErrorLogDialogProps {
  onClose: () => void
}

export function ErrorLogDialog({ onClose }: ErrorLogDialogProps) {
  const [entries, setEntries] = useState<ErrorLogEntry[]>([])

  useEffect(() => {
    void api.errorLog.list().then(setEntries)
  }, [])

  async function handleClear() {
    await api.errorLog.clear()
    setEntries([])
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="error-log-dialog" showCloseButton={false}>
        <div className="error-log-dialog-header">
          <DialogTitle asChild>
            <h2>Error log</h2>
          </DialogTitle>
          <button
            className="error-log-dialog-close"
            onClick={onClose}
            aria-label="Close error log"
            title="Close error log"
          >
            <X size={16} />
          </button>
        </div>

        <div className="error-log-dialog-body">
          {entries.length === 0 ? (
            <p className="error-log-empty">No errors recorded.</p>
          ) : (
            <ul className="error-log-list">
              {entries.map((entry, i) => (
                <li key={i} className="error-log-entry">
                  <span className="error-log-timestamp">{entry.timestamp}</span>
                  <span className="error-log-source">{entry.source}</span>
                  <span className="error-log-message">{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="error-log-dialog-footer">
          <button className="settings-reset" onClick={() => void handleClear()}>
            Clear log
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/ErrorLogDialog.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the Settings entry point**

In `src/components/SettingsPanel.tsx`:

Add to the imports:

```tsx
import { ErrorLogDialog } from './ErrorLogDialog'
```

Add state near the top of the component body (with the existing `const [error, setError] = useState<string | null>(null)`):

```tsx
const [showErrorLog, setShowErrorLog] = useState(false)
```

In the "Tools" section (`<p className="section-label">Tools</p>`), add a row after the "Run timeout (seconds)" row, before the section's closing `</div>`:

```tsx
<label className="settings-row">
  <span>
    Error log
    <small>Errors captured from this app, kept on this machine for later triage.</small>
  </span>
  <span className="settings-row-control">
    <button className="dialog-action" onClick={() => setShowErrorLog(true)}>
      View error log
    </button>
  </span>
</label>
```

The component currently returns a single `<Dialog>...</Dialog>` (`SettingsPanel.tsx:43-476`). Adding a sibling dialog means wrapping both in a fragment. Change the opening of the return (`SettingsPanel.tsx:43-44`) from:

```tsx
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
```

to:

```tsx
  return (
    <>
      <Dialog open onOpenChange={(next) => !next && onClose()}>
```

(indent everything between this line and the matching `</Dialog>` one level deeper to stay valid JSX), and change the closing (`SettingsPanel.tsx:474-477`) from:

```tsx
      </DialogContent>
    </Dialog>
  )
}
```

to:

```tsx
      </DialogContent>
      </Dialog>
      {showErrorLog && <ErrorLogDialog onClose={() => setShowErrorLog(false)} />}
    </>
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Run the full frontend test suite**

Run: `npm test`
Expected: all tests pass, including the new ones from Tasks 2, 4, and this task

- [ ] **Step 8: Commit**

```bash
git add src/components/ErrorLogDialog.tsx src/components/ErrorLogDialog.test.tsx src/components/SettingsPanel.tsx
git commit -m "feat: add error log viewer dialog to Settings"
```
