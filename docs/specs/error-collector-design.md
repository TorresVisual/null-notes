# In-app error collector

## Problem

Right now an error in the live app either shows a toast (`store/toast.ts`) and vanishes, or — for a Rust panic or a bug that only reproduces on the user's machine — leaves no trace at all. There is no way to come back later and see what actually broke in a real session. The goal is a durable, low-ceremony record of errors from both sides of the app, viewable without leaving it, so bugs surfacing in daily use get filed instead of forgotten.

This is not a replacement for the toast system — a toast is the in-the-moment "something went wrong" signal; the collector is the after-the-fact record of the same event, for triage.

## What gets captured

Per the storage-boundary rule (`CLAUDE.md`), this is machine-local, rebuildable-by-nature state — deleting `errors.log` loses history, not correctness — so it lives in the OS app-data dir next to `settings.json`, not in the workspace.

Three sources, all funneled through one entry shape:

1. **Rust panics.** A `std::panic::set_hook` installed at startup. Nothing else on the Rust side is separately intercepted: a Tauri command's `Err(String)` already becomes a rejected JS promise at the call site, which source 2 below already covers. Adding a second, Rust-side interception of the same failure would record every backend error twice.
2. **Frontend crashes.** `window.onerror`, a `window.addEventListener('unhandledrejection', ...)`, and a React error boundary's `componentDidCatch`. Together these catch anything that would otherwise be a silent white-screen or a rejected promise nobody awaited.
3. **`console.error` calls.** A one-time wrap at startup that logs, then calls through to the original — so any existing or future `console.error('...')` anywhere in the app is captured without each call site having to know the collector exists.

## Entry shape and storage

```json
{"timestamp":"2026-09-05T14:03:21Z","source":"panic","message":"index out of bounds","context":null}
```

`source` is one of `panic | window-error | unhandled-rejection | react-boundary | console-error`. `context` is an optional stack trace / component stack, kept as a plain string rather than a nested structure — nothing downstream parses it, it's read by a human.

One JSON object per line, appended to `errors.log` in the app-data dir. Appending a complete line is the atomicity guarantee here — no torn writes to guard against, unlike a note's `write_atomic` path, because there is nothing to corrupt except the entry currently being written, and a half-written last line is simply dropped by the line reader.

No rotation or size cap on the file itself: it is a debug log the user clears manually (below), not telemetry that accumulates forever unattended. `list_errors` reads only the last 200 lines, so an unclearred file doesn't make the viewer slow to render even if the user never clears it.

## Rust side

New `src-tauri/src/commands/error_log.rs`:

- `record_error(app, source: String, message: String, context: Option<String>) -> Result<(), String>` — the one write path, called by the frontend for sources 2 and 3. Opens `errors.log` in append mode and writes one line.
- `list_errors(app) -> Result<Vec<ErrorEntry>, String>` — last 200 entries, newest first.
- `clear_errors(app) -> Result<(), String>` — truncates the file.

Panic hook (source 1) is wired in `lib.rs`'s `.setup()`, where the app-data path is captured once into a `OnceLock<PathBuf>` (a panic hook has no `AppHandle` to ask). The hook itself is synchronous `std::fs` (not `tokio::fs` — no async runtime is guaranteed to still be around at panic time) and swallows its own I/O errors: a logging failure must never turn a panic into a double-panic.

## Frontend side

- `src/lib/errorLog.ts` — `logError(source, message, context?)`. Fire-and-forget wrapper over the `record_error` invoke; catches and drops its own failures. Never calls `console.error` (would recurse through the wrap below) and never throws.
- `main.tsx` gains the `window.onerror` and `unhandledrejection` listeners, and the one-time `console.error` wrap, all calling `logError`.
- New `src/components/ErrorBoundary.tsx`, a class component (React's `componentDidCatch` requires one — the one deliberate exception to this repo's functional-only convention), wrapping the app shell in `main.tsx`. Falls back to a minimal "Something went wrong, try reloading" screen rather than a blank one.
- New `src/components/ErrorLogDialog.tsx`, reusing the `Dialog`/`DialogContent` pattern already in `SettingsPanel.tsx`: a newest-first list of entries and a Clear button. Kept as its own dialog instead of a new section in `SettingsPanel.tsx` (already 477 lines) — opened from a new "View error log" button in Settings → Tools.
- `src/lib/tauri.ts` gains an `errorLog` namespace (`record`, `list`, `clear`) alongside the existing `settings` one.

## Testing

- Rust: append/list/clear round-trip against a tempdir, matching `settings.rs`'s existing test pattern; a test that `list_errors` caps at 200 even when the file holds more.
- Frontend: `logError` resolves without throwing when the underlying invoke rejects; `ErrorBoundary` renders its fallback and calls `logError` when a child throws.

## Out of scope

- **Deduplication / grouping identical errors.** Every occurrence is its own line; collapsing repeats is a viewer-side concern for later if the log turns out to be dominated by one repeating error.
- **Remote reporting (Sentry-style).** Everything here stays on the machine; nothing is sent anywhere.
- **Rust command `Err` interception on the backend.** Covered by the frontend's existing catch of every rejected `invoke()` call — see "What gets captured" above.
