# Embedded terminal pane (P8-1)

## Problem

The brief's actual AI ask, quoted in the roadmap, is *"a terminal in which I can do* `claude` *and work with the opened* `.md` *file"* — a terminal feature, not an AI feature. It ships no AI code, no API key handling, and works with any CLI tool the same way. The hard part is already built: P0-5's workspace watcher already detects a file changed by an external process, reloads it when the buffer is clean, and conflict-prompts when it's dirty. The terminal is a client of infrastructure that exists, not a new reload path.

## Why a real PTY

`claude` (and most CLIs worth running here — `git`, a REPL, `npm`) is interactive: it wants line editing, colour, `Ctrl+C`, and often a full TUI. A plain "shell out and capture stdout" model breaks all of that. The only way to give a program a real terminal is a real pseudo-terminal, and on Windows that means ConPTY — which rules out doing this by hand. [`portable-pty`](https://docs.rs/portable-pty) (from the wezterm project) is the standard, well-exercised answer: it wraps ConPTY on Windows and a real PTY elsewhere behind one API.

Two alternatives were considered and rejected:

- **Shell out per command, no PTY.** Fails the actual use case outright — an interactive `claude` session, arrow-key history, and anything TUI-based need a real terminal, not captured stdout.
- **Launch the OS's own terminal as a separate window.** Fails M8's own framing — "without leaving the app" — and "closing the pane" wouldn't map onto a window this app doesn't own.

## Architecture

```
┌─ Rust ────────────────────────────────┐        ┌─ Frontend ───────────────────────┐
│ commands/terminal.rs                  │        │ useTerminal.ts                   │
│  PtyState: Mutex<Option<PtySession>>  │        │  xterm.js + FitAddon              │
│  terminal_open(workspace, note, shell)│◄──────►│  invoke(terminal_open/write/      │
│  terminal_write(data)                 │ invoke │         resize/close)             │
│  terminal_resize(cols, rows)          │        │                                   │
│  terminal_close()                     │        │ listen("terminal-output", chunk) │
│                                        │────────►  atob(chunk) → Uint8Array        │
│  reader thread: pty.read() → base64   │  emit  │  → term.write(bytes)             │
│                → app.emit(...)        │        └───────────────────────────────────┘
└────────────────────────────────────────┘
```

**One session, not a map.** `PtyState` holds `Mutex<Option<PtySession>>` — this is *a* terminal pane (the roadmap's own wording), not a multi-tab terminal. `PtySession` bundles the `Box<dyn MasterPty>`, the `Box<dyn Child>` (needed for `.kill()`), and a writer handle.

**Output is base64.** PTY bytes aren't guaranteed valid UTF-8 — a multi-byte character can land split across two reads, and arbitrary binary can appear in escape sequences. Tauri events serialize through JSON, which requires valid UTF-8 strings, so raw bytes can't go straight through the way they could over a byte-oriented channel. This is the same shape as `read_ink`/`read_pdf_page`'s existing "binary data over IPC" pattern. The frontend decodes with `atob` and hands `xterm.js` a `Uint8Array` directly — `Terminal.write()` accepts bytes natively, so there's no lossy string round-trip, and xterm's own parser (which has to understand partial escape sequences anyway) is the right place to reassemble a split multi-byte character.

**Input is plain text.** Keystrokes arrive from `xterm.js`'s `onData` as already-decoded UTF-8 strings (they originate from real key events, not an arbitrary byte stream), so `terminal_write` takes a plain `String` — no encoding asymmetry to worry about here.

**Reader thread mirrors `watcher.rs`.** A background thread blocks on `pty.try_clone_reader()` reads and calls `app.emit("terminal-output", base64_chunk)` per chunk — same shape as the existing workspace watcher's debounce thread, minus the debounce (terminal output has no burst-coalescing rule; every chunk should render as soon as it arrives).

## Commands

| Command | Does |
|---|---|
| `terminal_open(workspace, note_path, shell)` | No-op if a session already exists (reopening reuses it, never respawns). Otherwise spawns `shell` (tokenized the same way `editor_launch.rs` tokenizes a template — split on whitespace into program + args) with cwd = `workspace` and env `NULL_NOTES_ACTIVE_NOTE` = `note_path` if given. Starts the reader thread. |
| `terminal_write(data)` | Writes `data` to the PTY's stdin. |
| `terminal_resize(cols, rows)` | Calls `MasterPty::resize`. |
| `terminal_close()` | Kills the child process and drops the session. |

No new note-content injection surface: unlike P7-1's editor launcher, nothing here comes from text a note's author wrote. `shell` comes from `AppSettings` (a value the user typed or the app auto-detected), and `workspace`/`note_path` are the app's own trusted state.

## The shell setting

New `AppSettings.terminal_shell: String`, `#[serde(default)]` so an existing `settings.json` still loads. Same detect-on-empty-only pattern as P7-4's `editor_command`: probes `PATH` for `pwsh` then `powershell` on Windows (`$SHELL`, falling back to `bash`, elsewhere), and only fills in when the field is empty — a typed value is never overwritten. Tokenized with the same whitespace-split `editor_launch.rs` already uses, so a value like `wsl -d Ubuntu` becomes program `wsl`, args `["-d", "Ubuntu"]`.

## Lifecycle — the part with real decisions

**Toggling the pane only shows or hides it.** The shell keeps running underneath. This is what lets a long `claude` session survive switching back to editing — the actual point of the feature. The `TerminalPane` component lazy-mounts on first open (so nothing PTY-related happens until you ask for it) and then stays mounted for the window's life; later toggles are a CSS visibility flip, not a mount/unmount, so `xterm.js`'s own scrollback buffer needs no backend-side replay.

**Actually closing kills the process.** Two paths do this: an explicit "Kill Terminal" button in the pane's header, and the app window closing. The existing `close-requested` → `flush()` → `saveSession()` → `confirm_close()` sequence in `Layout.tsx` gains one more step — `terminal_close()` — before `confirm_close()`, so quitting the app can't leave an orphaned shell behind. This is what the DoD's "closing the pane leaves no orphaned process" refers to; hiding the panel is not closing it.

**The env var is frozen at spawn.** `NULL_NOTES_ACTIVE_NOTE` is set once, from whichever note was active when the pane first opened — a running process's environment can't be rewritten from outside. The header button covers the live case instead: labeled with the *currently* active note's filename, it always inserts (types at the cursor, does not execute) that note's path, regardless of when the terminal was opened or how many tabs you've switched through since.

**Switching workspaces doesn't respawn a running terminal.** Killing an in-progress session because the sidebar changed workspace would be a worse surprise than a stale `cwd`. Recorded here as a known limitation, not fixed by this task.

**Verifying the "no new reload logic" claim needs no code.** `claude` (or anything else run in the pane) editing the open note is an ordinary filesystem write from the app's point of view — P0-5's watcher already reloads a clean buffer or raises the conflict bar on a dirty one. This is manually verified during QA, not implemented.

## UI

- **View menu**, alongside the existing toggle-view/insert-ink/graph-view items: `Toggle Terminal`, accelerator `Ctrl+\``.
- **Placement:** a docked panel at the bottom of the main content column (below `editor-scroll`, not overlapping the sidebar), matching the "pane" framing — this sits alongside the note, not over it like `SettingsPanel`/`GraphView`'s modal overlays.
- **Header:** the note-path insert button (see above) and the Kill Terminal button.
- `ShortcutsOverlay` gains the new entry.

## Testing

Pure functions — shell-template tokenizing, the auto-detect probe — get unit tests shaped exactly like `editor_launch.rs`'s (`tokenize` splitting, an empty template being refused, a typed value surviving detection). The PTY spawn/IO path itself isn't realistically unit-testable in this environment, the same category as pdfium-dependent code — it's manually QA'd, per `CLAUDE.md`'s existing precedent for Tauri IPC orchestration hooks.

Manual QA checklist for the DoD:

- Opening the pane spawns a shell rooted at the workspace directory.
- `echo %NULL_NOTES_ACTIVE_NOTE%` (or `$env:NULL_NOTES_ACTIVE_NOTE`) shows the path of the note that was active when the pane opened.
- Running `claude` (or any editor) against the open note's file updates the editor through the existing conflict/reload path, with no new code path involved.
- Toggling the pane closed and back open preserves scrollback and any running process.
- Killing the terminal, or closing the app window, leaves no `pwsh`/`powershell`/child process running (checked via Task Manager / `Get-Process`).

## Out of scope

- **Multiple terminal tabs.** One pane, one session — matches the roadmap's singular "a terminal pane."
- **Respawning on workspace switch.** See the lifecycle section above.
- **Any AI-specific code.** This is infrastructure for running *any* CLI; `claude` is the motivating example, not a special case.
