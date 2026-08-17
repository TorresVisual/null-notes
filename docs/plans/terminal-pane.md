# Embedded Terminal Pane (P8-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add a toggleable, PTY-backed terminal pane rooted at the open workspace, so `claude` (or any CLI) can run against the currently-open note without leaving the app.

**Architecture:** `portable-pty` (ConPTY on Windows) spawns a shell in Rust; a background thread streams its output as base64-encoded chunks over a Tauri event; the frontend decodes into `Uint8Array` and feeds `xterm.js`, which also sends typed input back through `invoke`. Toggling the pane only changes CSS visibility — the shell keeps running until an explicit kill or the app window closes.

**Tech Stack:** Rust (`portable-pty`, reusing existing `tauri`/`base64` deps), React + `@xterm/xterm` + `@xterm/addon-fit`.

**Spec:** `docs/specs/terminal-pane-design.md`

## Global Constraints

- PTY output is not guaranteed valid UTF-8 and Tauri events are JSON — always base64-encode a chunk before `app.emit`, matching the existing `read_ink`/`read_pdf_page` binary-over-IPC pattern (`base64::engine::general_purpose::STANDARD`, imported via `use base64::Engine;`).
- Terminal input from `xterm.js`'s `onData` is already-decoded text — send it to `terminal_write` as a plain `String`, no encoding step needed.
- `AppSettings.terminal_shell` follows the exact `editor_command` convention (P7-4): `#[serde(default)]` on the Rust struct so an older `settings.json` still loads; detection in `load_settings_from_dir` runs **only** when the field is empty, and never overwrites a value the user typed.
- No shell (`Command::new`, one `.arg()` per token) for spawning the PTY's program — reuse `editor_launch`'s tokenizer rather than duplicating it.
- Toggling the pane hides it via CSS only; it never unmounts and never kills the PTY session. Only an explicit "Kill Terminal" click or the app window closing calls `terminal_close`.
- The `NULL_NOTES_ACTIVE_NOTE` env var is set once, at `terminal_open` time, from whichever note is active then — it is never rewritten for a running session.
- Nothing in this feature is testable against real PTY I/O or real `xterm.js` rendering in this repo's test setup (no native PTY in CI, jsdom has no canvas/ResizeObserver `xterm.js` needs) — per `CLAUDE.md`'s existing precedent, that surface is manually QA'd, not unit tested. Only pure logic (tokenizing, settings round-trips) gets automated tests.

---

### Task 1: `commands::terminal` — PTY session lifecycle

**Files:**
- Modify: `src-tauri/src/commands/editor_launch.rs` (visibility of `tokenize` only)
- Create: `src-tauri/src/commands/terminal.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/Cargo.toml` (via `cargo add`)
- Test: `src-tauri/src/commands/terminal.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `pub(crate) fn tokenize(template: &str) -> Vec<String>` in `editor_launch.rs` (was private). `pub fn parse_shell(template: &str) -> Result<(String, Vec<String>), String>` and `pub fn detect_terminal_shell() -> String` in `terminal.rs` — the latter consumed by Task 2's `settings.rs`. `pub struct PtyState(pub Mutex<Option<PtySession>>)`, `Default`-derived. Tauri commands `terminal_open(workspace: String, note_path: Option<String>, shell: String, app: AppHandle, state: State<'_, PtyState>) -> Result<(), String>`, `terminal_write(data: String, state: State<'_, PtyState>) -> Result<(), String>`, `terminal_resize(cols: u16, rows: u16, state: State<'_, PtyState>) -> Result<(), String>`, `terminal_close(state: State<'_, PtyState>) -> Result<(), String>` — all consumed by Task 3's `lib.rs` registration and `src/lib/tauri.ts`.

- [ ] **Step 1: Widen `tokenize`'s visibility**

In `src-tauri/src/commands/editor_launch.rs`, change:

```rust
fn tokenize(template: &str) -> Vec<String> {
```

to:

```rust
pub(crate) fn tokenize(template: &str) -> Vec<String> {
```

No other change to that file. This is a visibility-only edit; the existing `tokenize`-exercising tests (via `build_command`) still cover it.

- [ ] **Step 2: Add the `portable-pty` dependency**

Run: `cd src-tauri && cargo add portable-pty`
Expected: `Cargo.toml`'s `[dependencies]` gains a `portable-pty = "…"` line (cargo resolves the current version).

- [ ] **Step 3: Register the module**

In `src-tauri/src/commands/mod.rs`, add alongside the other `pub mod` lines (alphabetical, matching the existing order):

```rust
pub mod terminal;
```

- [ ] **Step 4: Write the failing test for `parse_shell`**

Create `src-tauri/src/commands/terminal.rs` with just the parsing logic and its tests first:

```rust
//! The embedded terminal pane (P8-1).
//!
//! One PTY session at a time — `PtyState` holds `Option`, not a map, matching
//! the roadmap's own framing of "a terminal pane." Output isn't guaranteed
//! valid UTF-8 (a multi-byte character can split across two reads, and
//! arbitrary binary can appear in escape sequences), so it's base64-encoded
//! before crossing the IPC boundary — the same shape `read_ink`/`read_pdf_page`
//! already use for binary data over Tauri events/commands. Design:
//! `docs/specs/terminal-pane-design.md`.

use super::editor_launch::tokenize;

/// Splits a shell template into a program and its arguments — no placeholder
/// substitution, unlike `editor_launch::build_command`, because a shell needs
/// no `{file}`/`{line}` filled in.
pub fn parse_shell(template: &str) -> Result<(String, Vec<String>), String> {
    let tokens = tokenize(template);
    let (program, args) = tokens.split_first().ok_or("terminal shell is empty")?;
    Ok((program.clone(), args.to_vec()))
}

/// The shell to spawn when no setting has been chosen: probes for `pwsh`
/// then `powershell` on Windows (mirroring `editor_launch::detect_editor_command`'s
/// `where`-based probe), or `$SHELL` (falling back to `bash`) elsewhere.
pub fn detect_terminal_shell() -> String {
    if cfg!(windows) {
        for candidate in ["pwsh", "powershell"] {
            let found = std::process::Command::new("where")
                .arg(candidate)
                .output()
                .map(|out| out.status.success())
                .unwrap_or(false);
            if found {
                return candidate.to_string();
            }
        }
        "powershell".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_bare_shell_with_no_arguments() {
        let (program, args) = parse_shell("powershell").unwrap();
        assert_eq!(program, "powershell");
        assert!(args.is_empty());
    }

    #[test]
    fn parses_a_shell_with_arguments() {
        let (program, args) = parse_shell("wsl -d Ubuntu").unwrap();
        assert_eq!(program, "wsl");
        assert_eq!(args, ["-d", "Ubuntu"]);
    }

    #[test]
    fn refuses_an_empty_template() {
        assert!(parse_shell("   ").is_err());
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test terminal:: -- --nocapture`
Expected: PASS — `parses_a_bare_shell_with_no_arguments`, `parses_a_shell_with_arguments`, `refuses_an_empty_template`.

(This pure logic is short enough that it's written alongside its tests rather than test-first-then-red — there's no meaningful "watch it fail" step for a function this small. The PTY session code added next has no automated red/green cycle at all, per the Global Constraints note on manual QA.)

- [ ] **Step 6: Add the PTY session state and commands**

Append to `src-tauri/src/commands/terminal.rs`, above the `#[cfg(test)]` module:

```rust
use std::io::{Read, Write};
use std::sync::Mutex;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<Option<PtySession>>);

/// Spawns the configured shell rooted at `workspace`. A no-op if a session is
/// already open — reopening the pane reuses it rather than respawning, which
/// is what lets a long-running process (e.g. `claude`) survive the panel
/// being toggled shut and back open.
#[tauri::command]
pub fn terminal_open(
    workspace: String,
    note_path: Option<String>,
    shell: String,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let (program, args) = parse_shell(&shell)?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&program);
    cmd.args(&args);
    cmd.cwd(&workspace);
    // Frozen at spawn time — a running process's environment can't be
    // rewritten from outside. The terminal pane's header button covers the
    // "note changed since" case by inserting the live path as typed text.
    if let Some(note) = &note_path {
        cmd.env("NULL_NOTES_ACTIVE_NOTE", note);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The slave side is only needed to spawn the child; dropping it here
    // matches portable-pty's own examples and avoids holding an extra handle
    // open for the life of the session.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let emit_app = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    if emit_app.emit("terminal-output", chunk).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    *guard = Some(PtySession { master: pair.master, writer, child });
    Ok(())
}

#[tauri::command]
pub fn terminal_write(data: String, state: State<'_, PtyState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let session = guard.as_mut().ok_or("no terminal session is open")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(cols: u16, rows: u16, state: State<'_, PtyState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let session = guard.as_ref().ok_or("no terminal session is open")?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

/// Kills the running shell, if any. This — not toggling the pane closed — is
/// what the DoD's "no orphaned process" applies to. A no-op (`Ok(())`) when
/// no session is open, so callers never need to check first.
#[tauri::command]
pub fn terminal_close(state: State<'_, PtyState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = guard.take() {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
```

- [ ] **Step 7: Build to confirm it compiles**

Run: `cd src-tauri && cargo build`
Expected: builds clean. If `portable-pty`'s trait bounds differ slightly from what's written above (e.g. `MasterPty`/`Child` not re-exported at the crate root, or a method named differently), fix the `use` line or method call to match — check `cargo doc -p portable-pty --open` or the crate's docs.rs page if the compiler error isn't self-explanatory. The session-shape (one `master`, one `writer`, one `child`, guarded by one `Mutex<Option<_>>`) is the part that must not change.

- [ ] **Step 8: Run clippy**

Run: `cd src-tauri && cargo clippy -- -D warnings`
Expected: clean. Per `CLAUDE.md`, no warnings are allowed — fix anything it flags (e.g. an unused `mut`, a needless `.clone()`) before moving on.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/commands/editor_launch.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands/terminal.rs src-tauri/src/commands/mod.rs
git commit -m "feat(p8-1): add the PTY session backend (portable-pty)"
```

---

### Task 2: `terminal_shell` setting

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands/settings.rs`
- Test: `src-tauri/src/commands/settings.rs` (existing `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `commands::terminal::detect_terminal_shell` (Task 1).
- Produces: `AppSettings.terminal_shell: String` — consumed by Task 4's TypeScript `AppSettings` type and Task 5's `TerminalPane`.

- [ ] **Step 1: Add the `terminal_shell` field to `AppSettings`**

In `src-tauri/src/models.rs`, add the field after `editor_command` in the struct:

```rust
    /// The shell a terminal pane spawns, e.g. `powershell` or `wsl -d Ubuntu`.
    /// Tokenized the same way as `editor_command`, run without a shell — see
    /// `commands::terminal`. Empty means "detect on next load."
    #[serde(default)]
    pub terminal_shell: String,
```

And in `impl Default for AppSettings`, add the matching field:

```rust
            terminal_shell: String::new(),
```

- [ ] **Step 2: Write the failing settings tests**

In `src-tauri/src/commands/settings.rs`'s `#[cfg(test)] mod tests`, update `test_roundtrip` to set and assert the new field:

```rust
    #[tokio::test]
    async fn test_roundtrip() {
        let dir = tempdir().unwrap();
        let original = AppSettings {
            autosave_debounce_ms: 1200,
            editor_max_width_px: 960,
            spellcheck: true,
            spellcheck_language: "en".to_string(),
            pdf_import_mode: crate::models::PdfImportMode::Markdown,
            editor_command: "nvim +{line} {file}".to_string(),
            terminal_shell: "wsl -d Ubuntu".to_string(),
        };
        save_settings_to_dir(dir.path(), &original).await.unwrap();
        let loaded = load_settings_from_dir(dir.path()).await.unwrap();
        assert_eq!(loaded.autosave_debounce_ms, 1200);
        assert_eq!(loaded.editor_max_width_px, 960);
        assert!(loaded.spellcheck);
        assert_eq!(loaded.spellcheck_language, "en");
        assert_eq!(loaded.editor_command, "nvim +{line} {file}");
        assert_eq!(loaded.pdf_import_mode, crate::models::PdfImportMode::Markdown);
        assert_eq!(loaded.terminal_shell, "wsl -d Ubuntu");
    }
```

Also add two new tests, mirroring `editor_command`'s existing detection tests exactly:

```rust
    #[tokio::test]
    async fn test_an_empty_terminal_shell_is_filled_in_on_load() {
        let dir = tempdir().unwrap();
        tokio::fs::write(
            dir.path().join(SETTINGS_FILE),
            r#"{"autosaveDebounceMs":600,"editorMaxWidthPx":800}"#,
        )
        .await
        .unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert!(!loaded.terminal_shell.trim().is_empty(), "got {:?}", loaded.terminal_shell);
    }

    // A shell the user typed is never replaced by detection, same guarantee
    // P7-4 gives editor_command.
    #[tokio::test]
    async fn test_a_configured_terminal_shell_survives_detection() {
        let dir = tempdir().unwrap();
        let mut settings = AppSettings::default();
        settings.terminal_shell = "wsl -d Ubuntu".to_string();
        save_settings_to_dir(dir.path(), &settings).await.unwrap();

        let loaded = load_settings_from_dir(dir.path()).await.unwrap();

        assert_eq!(loaded.terminal_shell, "wsl -d Ubuntu");
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test settings:: -- --nocapture`
Expected: compile error — `AppSettings`'s struct literal in `test_roundtrip` and the new tests reference a `terminal_shell` field that doesn't exist on the struct yet (Step 1 hasn't been applied in the compiler's view if you're running this strictly before it — in practice, write Step 1 and Step 2 together and use this run to confirm the *assertions*, not the field's existence, are what's under test). If you want a true red step, comment out Step 1's field addition temporarily, confirm the "no field `terminal_shell`" error, then restore it.

- [ ] **Step 4: Wire detection into `load_settings_from_dir`**

In `src-tauri/src/commands/settings.rs`, add the detection call alongside the existing `editor_command` one:

```rust
    if settings.editor_command.trim().is_empty() {
        settings.editor_command = super::editor_launch::detect_editor_command();
    }
    if settings.terminal_shell.trim().is_empty() {
        settings.terminal_shell = super::terminal::detect_terminal_shell();
    }
    Ok(settings)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test settings:: -- --nocapture`
Expected: PASS — `test_roundtrip`, `test_an_empty_terminal_shell_is_filled_in_on_load`, `test_a_configured_terminal_shell_survives_detection` all green.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands/settings.rs
git commit -m "feat(p8-1): add the terminal_shell setting"
```

---

### Task 3: Register commands and the View-menu item

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `commands::terminal::{terminal_open, terminal_write, terminal_resize, terminal_close, PtyState}` (Task 1).
- Produces: the `"toggle-terminal"` menu-action id, consumed by Task 6's `Layout.tsx` dispatcher.

- [ ] **Step 1: Manage `PtyState`**

In `src-tauri/src/lib.rs`'s `.setup(|app| { … })` closure, add alongside the existing `app.manage(commands::watcher::WatcherState::default());`:

```rust
            app.manage(commands::terminal::PtyState::default());
```

- [ ] **Step 2: Add the View-menu item**

In `build_menu`'s `view_menu`, add a new item after `graph-view` and before the separator/`shortcuts-help`:

```rust
            &MenuItem::with_id(handle, "graph-view", "Connections Graph", true, Some("CmdOrCtrl+G"))?,
            &MenuItem::with_id(handle, "toggle-terminal", "Toggle Terminal", true, Some("CmdOrCtrl+`"))?,
            &PredefinedMenuItem::separator(handle)?,
```

If `"CmdOrCtrl+`"` fails to parse as an accelerator at runtime (check by running `npm run tauri dev` and watching for a startup error), fall back to `None::<&str>` for the accelerator argument and leave the menu item reachable by click only — the toggle is still wired through `runCommand` either way, so losing the accelerator string does not lose the feature.

- [ ] **Step 3: Register the four commands**

In the `.invoke_handler(tauri::generate_handler![ … ])` list, add after `commands::editor_launch::resolve_code_links,`:

```rust
            commands::terminal::terminal_open,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
```

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build`
Expected: builds clean.

- [ ] **Step 5: Run the full Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: PASS, including Task 2's settings tests.

- [ ] **Step 6: Run clippy**

Run: `cd src-tauri && cargo clippy -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(p8-1): register the terminal commands and menu item"
```

---

### Task 4: Frontend plumbing — types, `api`, settings store, settings row

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/store/settings.ts`
- Modify: `src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: the four Tauri commands from Task 3.
- Produces: `AppSettings.terminalShell: string`. `api.terminal.{open, write, resize, close}` — consumed by Task 5's `useTerminal` hook.

- [ ] **Step 1: Add `terminalShell` to the `AppSettings` type**

In `src/types/index.ts`, add after `editorCommand`:

```ts
  /** Shell a terminal pane spawns, e.g. `powershell` or `wsl -d Ubuntu`. */
  terminalShell: string
```

- [ ] **Step 2: Add the `terminal` namespace to `api`**

In `src/lib/tauri.ts`, add a new top-level key alongside `pdf`:

```ts
  terminal: {
    open: (workspace: string, notePath: string | null, shell: string) =>
      invoke<void>('terminal_open', { workspace, notePath, shell }),
    write: (data: string) =>
      invoke<void>('terminal_write', { data }),
    resize: (cols: number, rows: number) =>
      invoke<void>('terminal_resize', { cols, rows }),
    close: () =>
      invoke<void>('terminal_close'),
  },
```

- [ ] **Step 3: Add the default and a settings-panel row**

In `src/store/settings.ts`, add to `DEFAULT_SETTINGS`:

```ts
  terminalShell: 'powershell',
```

(A concrete default, not an empty string — same reasoning as `editorCommand`'s hardcoded `'code -g {file}:{line}'`: this is what "Reset to defaults" writes immediately, and only `load_settings`'s backend detection runs the empty-triggers-probe logic, so an empty string here would show a blank box until the next full reload.)

In `src/components/SettingsPanel.tsx`, add a new `settings-row` after the "Editor command" one:

```tsx
        <label className="settings-row">
          <span>
            Terminal shell
            <small>
              Spawned by the terminal pane (<code>Ctrl `</code>), rooted at the workspace. Detected on
              first load.
            </small>
          </span>
          <span className="settings-row-control">
            <input
              type="text"
              className="settings-text settings-text-wide"
              value={settings.terminalShell}
              onChange={(e) => void update({ terminalShell: e.target.value })}
            />
          </span>
        </label>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes clean.

- [ ] **Step 5: Run the existing settings test**

Run: `npx vitest run src/store/settings.test.ts`
Expected: PASS (this file doesn't assert on individual field values by name in a way that would break from an added field — confirm by reading it if the run surprises you).

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/tauri.ts src/store/settings.ts src/components/SettingsPanel.tsx
git commit -m "feat(p8-1): wire terminalShell through settings and the api layer"
```

---

### Task 5: `useTerminal` hook and `TerminalPane` component

**Files:**
- Create: `src/hooks/useTerminal.ts`
- Create: `src/components/TerminalPane.tsx`
- Modify: `package.json` (via `npm install`)

**Interfaces:**
- Consumes: `api.terminal.*` (Task 4), `listen` from `@tauri-apps/api/event`.
- Produces: `useTerminal(containerRef: RefObject<HTMLDivElement>, workspace: string, notePath: string | null, shell: string): { insertText: (text: string) => void; kill: () => Promise<void> }`. `<TerminalPane workspace notePath shell hidden onClose />` — consumed by Task 6's `Layout.tsx`.

- [ ] **Step 1: Install the frontend dependencies**

Run: `npm install @xterm/xterm @xterm/addon-fit`
Expected: `package.json`'s `dependencies` gains both.

- [ ] **Step 2: Import xterm's stylesheet globally**

In `src/main.tsx`, add alongside the existing `katex` CSS import:

```ts
import '@xterm/xterm/css/xterm.css'
```

- [ ] **Step 3: Write `useTerminal`**

Create `src/hooks/useTerminal.ts`:

```ts
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { listen } from '@tauri-apps/api/event'
import { api } from '../lib/tauri'

// PTY output crosses the IPC boundary as base64 (see commands/terminal.rs) —
// bytes, not a decoded string, so a multi-byte character split across two
// reads is xterm's own parser's problem to reassemble, not this hook's.
function decodeChunk(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function useTerminal(
  containerRef: RefObject<HTMLDivElement>,
  workspace: string,
  notePath: string | null,
  shell: string,
) {
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({ convertEol: true, fontSize: 13 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    termRef.current = term

    void api.terminal.open(workspace, notePath, shell)
    void api.terminal.resize(term.cols, term.rows)

    const dataSub = term.onData((data) => void api.terminal.write(data))
    const outputUnlisten = listen<string>('terminal-output', (event) => {
      term.write(decodeChunk(event.payload))
    })

    const resizeObserver = new ResizeObserver(() => {
      fit.fit()
      void api.terminal.resize(term.cols, term.rows)
    })
    resizeObserver.observe(container)

    return () => {
      dataSub.dispose()
      void outputUnlisten.then((off) => off())
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
    }
    // Deliberately empty: this effect spawns the session once on mount
    // (TerminalPane lazy-mounts exactly once — see its own comment) and never
    // re-runs for a workspace/note/shell change, matching the design's
    // "switching workspaces doesn't respawn a running terminal" decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function insertText(text: string) {
    void api.terminal.write(text)
  }

  async function kill() {
    await api.terminal.close()
  }

  return { insertText, kill }
}
```

- [ ] **Step 4: Write `TerminalPane`**

Create `src/components/TerminalPane.tsx`:

```tsx
import { useRef } from 'react'
import { X } from 'lucide-react'
import { useTerminal } from '../hooks/useTerminal'

interface TerminalPaneProps {
  workspace: string
  notePath: string | null
  shell: string
  hidden: boolean
  onClose: () => void
}

// Lazy-mounted exactly once by Layout (see its own comment) and then only
// ever hidden/shown via CSS — the whole point is that the shell underneath
// survives the panel being toggled shut, so this component must never
// unmount as a side effect of the toggle.
export function TerminalPane({ workspace, notePath, shell, hidden, onClose }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { insertText, kill } = useTerminal(containerRef, workspace, notePath, shell)

  const noteLabel = notePath ? notePath.split(/[\\/]/).pop() : null

  return (
    <div className="terminal-pane" style={{ display: hidden ? 'none' : 'flex' }}>
      <div className="terminal-pane-header">
        {noteLabel && (
          <button
            className="terminal-pane-insert"
            title="Insert this note's path at the cursor"
            onClick={() => notePath && insertText(notePath)}
          >
            {noteLabel}
          </button>
        )}
        <button
          className="terminal-pane-kill"
          title="Kill terminal"
          onClick={() => {
            void kill()
            onClose()
          }}
        >
          <X size={14} />
        </button>
      </div>
      <div className="terminal-pane-body" ref={containerRef} />
    </div>
  )
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/hooks/useTerminal.ts src/components/TerminalPane.tsx
git commit -m "feat(p8-1): add the useTerminal hook and TerminalPane component"
```

---

### Task 6: Wire into `Layout`, add styling, shortcuts entry, kill-on-quit

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/ShortcutsOverlay.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `TerminalPane` (Task 5), the `"toggle-terminal"` menu-action id (Task 3), `api.terminal.close` (Task 4).
- Produces: nothing further — this is the last code task.

- [ ] **Step 1: Add terminal state and lazy-mount to `Layout`**

In `src/components/Layout.tsx`, import the component:

```tsx
import { TerminalPane } from './TerminalPane'
```

Add state near the other `useState` calls:

```tsx
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
```

Add a case to `runCommand`'s `switch`, after `case 'graph-view':`:

```tsx
        case 'toggle-terminal':
          if (!workspacePath) break
          setTerminalMounted(true)
          setTerminalOpen((o) => !o)
          break
```

No change is needed to `runCommand`'s `useCallback` dependency array — `workspacePath` is already in it, and `setTerminalMounted`/`setTerminalOpen` are state setters with stable identity.

- [ ] **Step 2: Kill the terminal before the window actually closes**

In the `close-requested` listener, add the kill call before `confirmClose`:

```tsx
  useEffect(() => {
    const unlisten = listen('close-requested', async () => {
      try {
        await flush()
        await saveSession()
      } finally {
        await api.terminal.close()
        await api.window.confirmClose()
      }
    })
    return () => void unlisten.then((off) => off())
  }, [flush, saveSession])
```

`api.terminal.close()` is safe to call even when no terminal was ever opened — `terminal_close`'s backend implementation is a no-op `Ok(())` when `PtyState` holds `None` (Task 1, Step 6).

- [ ] **Step 3: Render `TerminalPane`**

In the JSX, inside `<div className="main">`, add after the `<div className="editor-scroll">…</div>` block and before the closing `</div>` of `.main`:

```tsx
        {terminalMounted && workspacePath && (
          <TerminalPane
            workspace={workspacePath}
            notePath={activeTab}
            shell={settings.terminalShell}
            hidden={!terminalOpen}
            onClose={() => setTerminalOpen(false)}
          />
        )}
```

- [ ] **Step 4: Add the shortcuts-overlay entry**

In `src/components/ShortcutsOverlay.tsx`, add to `SHORTCUTS` after the `Ctrl G` row:

```ts
  { keys: 'Ctrl `', label: 'Toggle terminal' },
```

- [ ] **Step 5: Add CSS**

In `src/index.css`, add after the `.editor-scroll` rule (around line 141):

```css
/* Terminal pane — docked at the bottom of the main column, not a modal
   overlay, since it sits alongside the note rather than over it. */
.terminal-pane {
  flex-shrink: 0;
  height: 280px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-sunken);
}

.terminal-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.terminal-pane-insert {
  background: none;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 2px 8px;
  cursor: pointer;
}

.terminal-pane-insert:hover { background: var(--bg-hover); color: var(--text-primary); }

.terminal-pane-kill {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 2px 6px;
  display: flex;
  align-items: center;
}

.terminal-pane-kill:hover { color: var(--danger); }

.terminal-pane-body {
  flex: 1;
  padding: 4px 8px;
  overflow: hidden;
}
```

- [ ] **Step 6: Typecheck and run the full frontend test suite**

Run: `npm run typecheck && npm test`
Expected: both pass clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/Layout.tsx src/components/ShortcutsOverlay.tsx src/index.css
git commit -m "feat(p8-1): dock the terminal pane in Layout, kill it on window close"
```

---

### Task 7: Manual QA pass (not automatable — run this yourself)

**Files:** none — this task produces no diff. If a bug turns up, fix it and fold the fix into whichever earlier task it belongs to (amend forward with a new commit, not by rewriting history).

- [ ] **Step 1: Launch the app**

Run: `npm run tauri dev`
Expected: the app opens with no console error about the `Ctrl+\`` menu accelerator (see Task 3, Step 2's fallback note — if it errored, confirm the fallback was applied and the item still appears in the View menu).

- [ ] **Step 2: Open the terminal and confirm the workspace root**

Open a workspace, press `Ctrl+\`` (or View > Toggle Terminal). Expected: a shell prompt appears in the bottom panel, already `cd`'d into the open workspace folder (check with `pwd` / `Get-Location`).

- [ ] **Step 3: Confirm the env var**

With a note open, in the terminal pane run `echo $env:NULL_NOTES_ACTIVE_NOTE` (PowerShell) or `echo $NULL_NOTES_ACTIVE_NOTE` (bash/wsl). Expected: prints the path of the note that was active when the pane was first opened.

- [ ] **Step 4: Confirm the insert button**

Click the header button labeled with the active note's filename. Expected: the note's full path is typed at the terminal's cursor, not executed.

- [ ] **Step 5: Confirm external edits reach the editor with no new code path**

In the terminal, run an editor (or `echo` append) against the open note's `.md` file directly. Expected: if the note's buffer is clean, it reloads automatically; if dirty, the existing P0-5 conflict bar appears. No new reload behavior should be visible — this is the same path P0-5 already built.

- [ ] **Step 6: Confirm hide/show preserves the session**

Toggle the pane closed, then open again. Expected: scrollback and any still-running foreground process (e.g. leave `ping -t localhost` running before toggling) are exactly as left.

- [ ] **Step 7: Confirm kill and window-close leave no orphan**

Click "Kill Terminal," then check `Get-Process | Where-Object { $_.ProcessName -match 'powershell|pwsh|bash' }` (adjust for your configured shell) for a lingering process tied to the app. Reopen the pane, then close the whole app window instead of killing manually, and repeat the process check. Expected: no orphaned shell process either way.

- [ ] **Step 8: Update the roadmap and TODO**

In `docs/ROADMAP.md`'s P8-1 section, add the `✅` marker and a short "Done:" paragraph describing what shipped (the pattern every other completed task in that file follows) plus any manual-QA findings worth recording. In `TODO.md`, check off P8-1's four boxes under `▸ P8 — Embedded terminal (M8)`, and move P8 from the "Progress" table's blank cell to `✅` if this closes M8 (it does — M8's own milestone is exactly "`claude` runs against the open note without leaving the app," which this delivers). Commit:

```bash
git add docs/ROADMAP.md TODO.md
git commit -m "docs(p8-1): mark the terminal pane done, M8 reached"
```
