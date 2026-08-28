# In-editor code execution (P10-2)

## Problem

The roadmap names this feature but gates it explicitly: *"Real sandboxing, toolchain detection, and security review required before this is more than a toy... significant security surface; do not start without a dedicated design+security pass."* This is that pass.

A fenced Python or C++ code block should get a **Run** button that executes it and shows output inline, the way a notebook cell does. The hard question isn't the plumbing — it's what to do about the fact that a note is attacker-influenced content (per `editor_launch.rs`'s own framing: notes arrive by Git pull, Syncthing, or PDF conversion) and this feature's entire purpose is to execute that content.

## The security decision

Three postures were considered:

- **Real isolation (container or WASM).** Docker gives genuine filesystem/network confinement, but adds a large, fragile dependency to a personal Windows app that has none today — no Docker Desktop requirement exists anywhere else in this codebase. A WASM runtime (wasmtime + WASI for C/C++, a WASM Python interpreter for Python) needs no extra install, but can't run real coursework code that pulls in `pip` packages or links real libraries — it would be sandboxed and also useless for the actual use case.
- **No sandbox, run-with-friction (chosen).** The user already has unsandboxed code execution today, via the P8 terminal — typing `python foo.py` there is already possible and already trusted. This feature doesn't raise the ceiling of what's possible, only the convenience of doing it from a code block instead of a typed command. So the mitigation is **friction and visibility**, not containment: never auto-run (not on note open, not on sync, not on import — only an explicit click), a confirmation the first time a note runs anything in a given session, and output that's always visible while it happens. This is deliberately the same trust boundary as P8's terminal, applied to a lower-friction entry point.
- **Off by default, global settings toggle.** Considered and rejected in favor of confirm-per-note: a single global switch would either block first-time discovery entirely or, once flipped on, silently re-enable running arbitrary content on every note thereafter with no further signal. A per-note, per-session confirmation keeps the "you're about to run this" moment attached to the actual note each time.

**What this explicitly does not protect against:** once code runs, it has full user-level OS access — same as the terminal. A malicious script can still read/write real files (via an absolute path; the temp-dir cwd only prevents *accidental* relative-path collisions with real notes) or reach the network. No resource limit exists beyond a wall-clock timeout. This is a conscious trade-off for a personal single-user tool, not an oversight — recorded here so it isn't rediscovered as a "bug" later.

## Architecture

```
┌─ Rust ──────────────────────────────────┐        ┌─ Frontend ──────────────────────────┐
│ commands/code_run.rs                    │        │ CodeBlockToolbar.ts (Run button)     │
│  RunState: Mutex<HashMap<Uuid, Run>>    │        │ CodeRunPanel.ts (output + stdin +    │
│  run_code(language, source) -> Uuid     │◄──────►│              Stop, widget below      │
│  send_input(run_id, text)               │ invoke │              the code block)         │
│  stop_run(run_id)                       │        │                                       │
│                                          │────────►  listen("code-run-output", chunk)    │
│  Run { child, temp_dir }                │  emit  │  listen("code-run-exit"/"-timeout")  │
│  async read loop → base64 chunks        │        └───────────────────────────────────────┘
└──────────────────────────────────────────┘
```

Each run gets its own `Uuid`, its own `tempfile::TempDir`, and its own entry in the map — unlike P8's single-session `PtyState`, multiple code blocks in the same note can run independently without blocking each other.

**No note-content injection surface.** Unlike `editor_launch.rs` (which resolves a path *taken from* note text) or `terminal.rs` (which spawns a user-configured shell), this feature never turns note text into a path or a command-line argument. The code block's raw content is written verbatim as the *contents* of a file this module names and controls (`{uuid}.py` / `{uuid}.cpp`) inside a temp directory it creates. The only external inputs to `std::process::Command` are the configured interpreter/compiler command (from `AppSettings`, same trust level as `editor_command`/`terminal_shell`) and paths the backend itself generated.

## Commands

| Command | Does |
|---|---|
| `run_code(language, source)` | Creates a fresh `TempDir`. For `python`: writes `source` to `main.py`, spawns `<python_command> main.py` with cwd = the temp dir, `Stdio::piped()` on stdin/stdout/stderr. For `cpp`/`c++`/`c`: writes `source` to `main.cpp`, spawns `<cpp_compiler_command> main.cpp -o main.exe` first; a nonzero exit surfaces stderr as a compile error and stops there — the binary is never invoked. On success, spawns `main.exe` the same way. Starts an async read loop emitting `code-run-output` (base64, tagged with the run's `Uuid` — same reasoning as the terminal's binary-safe output) and races the child against `code_run_timeout_secs`. Returns the `Uuid` immediately so the frontend can attach its output panel before the process necessarily finishes. |
| `send_input(run_id, text)` | Writes `text` + `\n` to the run's piped stdin. No-op (returns an error) if the run has already exited. |
| `stop_run(run_id)` | Kills the child, removes it from the map. The temp dir is dropped (and deleted) along with the `Run` entry. |

Exit is reported as exactly one of `code-run-exit(code)` or `code-run-timeout` — the UI needs to tell "finished on its own" from "killed for running too long" apart, and they render differently (a timeout is a warning state, a nonzero exit is just a nonzero exit).

## Settings

New fields on `AppSettings`, same "empty means detect on next load" shape as `editor_command`/`terminal_shell`:

- `python_command: String` — `detect_python_command()` probes `PATH` for `python3` then `python` (same `where`/`which` pattern as `detect_editor_command`).
- `cpp_compiler_command: String` — `detect_cpp_compiler_command()` probes for `g++` then `clang++`. MSVC's `cl.exe` is a known gap for v1 (it needs `vcvarsall.bat`-style environment setup to work outside a Developer Command Prompt — a distinct problem, not a shortcut worth cutting a corner on here).
- `code_run_timeout_secs: u32`, `#[serde(default = "default_code_run_timeout_secs")]` → `10`.

Both command fields are tokenized the same whitespace-split way as `editor_command` if a user ever needs to pass a flag (e.g. `python3.11`), though the common case is a bare program name.

## Confirmation & lifecycle

- **Per-note, per-session, in-memory only.** A Zustand set of note paths that have been confirmed this session — nothing written to `settings.json`, the note file, or `index.db`. Restarting the app clears it, so every session re-asks the first time a note tries to run something. This deliberately adds no new persisted state, consistent with the "derived-not-authoritative" rule for anything that isn't note content.
- The confirm dialog is `confirm()` from `@tauri-apps/plugin-dialog` — the native-dialog replacement for `window.confirm` this codebase already uses everywhere a yes/no confirmation is needed (`TreeNode.tsx`, `NoteHistoryPanel.tsx`, `SettingsPanel.tsx`). `PromptDialog` is a different component, reserved for free-text input (`window.prompt`'s replacement) — not the right fit here.
- **Never automatic.** No run is triggered by opening a note, by the watcher picking up an external change, by a Git pull, or by a PDF import — only a direct click on a block's Run button, after which the confirmation gate (if not already passed this session) fires before anything spawns.
- Closing the output panel (or the note) while a run is active kills it via `stop_run`, the same "actually closing kills the process" rule P8's terminal already follows for the app window closing.

## UI

- `CodeBlockToolbar.ts`: a **Run** button, shown only when `language` is `python`, `cpp`, `c++`, or `c` — same per-block toolbar mechanism as P11-1's copy/wrap buttons.
- A new output panel (widget decoration below the block, same idiom as `CodeBlockSearch.ts`'s in-block search bar) — streaming stdout/stderr, a one-line stdin input (only enabled while a process is alive), and a Stop button. Idle state collapses back to just the Run button. Never serialized into the note — purely presentational, like fold state and `codeBlock.wrap`.
- Settings panel: three new fields (Python command, C++ compiler command, run timeout) in the same layout as the existing editor-command/terminal-shell rows.
- `ShortcutsOverlay`: no new shortcut proposed for v1 — Run is a click target on the block itself, not a global keybinding, since a keybinding would need "the block under the cursor" targeting that doesn't exist for any other block-level action today.

## Testing

- Rust unit tests, shaped like `editor_launch.rs`'s (no real interpreter/compiler needed): argv construction (confirming no shell involvement and no note-derived path/argument), toolchain-agnostic pure helpers, timeout-decision logic.
- The `run_code`/`send_input`/`stop_run` command handlers themselves are **not unit tested** — they need a real OS process and a real Tauri `AppHandle`, the same category `terminal.rs`'s PTY spawn/IO path already is in this codebase (its own design doc: *"isn't realistically unit-testable in this environment... manually QA'd"*). Verified via `cargo build`/`cargo clippy` plus a manual QA checklist, not an `#[ignore]`d integration test.
- Frontend: Run-button visibility per language, output panel streaming/rendering, confirm-dialog gating (shows once per note per session, not on the second run) — unit tests. The full run-and-see-output loop against a real compiled app is manual/e2e, subject to this project's already-documented WebView cold-start flake.

**DoD:**
- A Python block printing `"hi"` runs and shows `hi` in the panel.
- A C++ block with a syntax error shows the compiler's stderr and never attempts to execute a binary.
- An infinite-loop block is killed at the configured timeout and reports `code-run-timeout`, distinguishable in the UI from a normal exit.
- Stop kills a running block immediately, and the temp dir is gone afterward.
- A script using `input()`/`cin >>` receives text typed into the panel's stdin box and produces the expected output.
- Closing and reopening the app clears all confirmations — running code in any note re-prompts.
- No shell is ever invoked, and no argument or path passed to `std::process::Command` is derived from note text — confirmed by the unit tests above, not just by inspection.

## Out of scope (v1)

- **MSVC (`cl.exe`) support** — needs its own environment-setup design.
- **Real sandboxing** (container/WASM) — the security posture section above explains why this is a conscious, not deferred-by-oversight, decision. Revisit only if real use surfaces an actual incident, not speculatively.
- **Multi-file C++ projects** — one fenced block, one translation unit.
- **Package management** (`pip install`, external libraries beyond what's already on the machine) — a block runs against whatever the configured interpreter/compiler already has available.
- **Persisting run output into the note** — output lives only in the panel for the session, like terminal scrollback.
- **A global "disable code execution" switch** — the per-note confirmation already gates every run; a second off-switch would duplicate it without adding protection.
