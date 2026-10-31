# `nullnotes` CLI — Design

Competitor reference: Obsidian CLI (`docs/competitor-audits/obsidian/`, EX-007). The audit declined to file it ("no consumer; plain files already work"). The consumer it missed is **coding agents** (Claude in the IDE extension, scripts) that need what plain files cannot give: the derived index (FTS search, tags, backlinks, links, flashcards/SRS, tasks) and safe writes that respect the save path.

## Intent

A `nullnotes` command that lets agents — and, secondarily, the user at a shell — do everything the app can do to a workspace, with machine-readable output. Works whether or not Null Notes is open.

## Goals

- Agents are the primary consumer: stable JSON output, meaningful exit codes, no interactive prompts.
- Works with the app closed (the CLI starts it) and with the app open (it talks to the running instance).
- Broad coverage: notes, search, tags, links/backlinks, tasks, flashcards, folders, templates, trash, bookmarks, git — everything backed by an existing Tauri command, minus the exclusions below.
- Writes obey the save path rules in `CLAUDE.md` (`write_atomic`, no DB work on save, never overwrite a dirty buffer).

## Non-goals

- A TUI. Separate spec, built on this one (see "Later").
- Live-UI commands (open tab, active note, selection). Separate spec; the pipe makes them possible but they are not in v1.
- A standalone binary that reads `index.db` without the app. Rejected, see Approaches.
- Non-Windows platforms (the app is Windows-primary).

## Anti-goals

- Exposing process-spawning commands over the pipe. A pipe that can reach `code_run` or `editor_launch` is a new injection path for note-derived input.
- A second source of truth for business logic. If the CLI and the app can disagree about what `rename_note` does, this has failed.

## Approaches

1. **Shared-core CLI** — extract a Tauri-free crate, ship a standalone binary reading the workspace and `index.db` directly. Works with the app closed without launching anything. Rejected: ~100 commands take `State<DbPool>`/`AppHandle`, so this needs a large refactor first, and it adds a second `index.db` writer racing the app's watcher.
2. **App as the server (chosen)** — the CLI is a thin client; the app listens on a local named pipe; if no app is running the CLI starts one with a hidden window. One code path, every command the app has, no refactor. Costs a 1–3 s cold start and a hidden WebView2 process.
3. **Hybrid** — approach 1 for data, a pipe only for live-UI commands. Rejected once the user accepted the cold start: it is approach 2 plus a refactor.

Chosen by the user: approach 2.

## Design

### Binary

`nullnotes` (the user's call; `null` belongs to their Null IDE). A separate small Rust binary in `src-tauri` (second `[[bin]]`, console subsystem so stdout works on Windows — the app exe is GUI-subsystem and cannot print). It contains no domain logic: parse args, connect, send one request, print one response.

### Pipe server (in the app)

- Windows named pipe via `tokio::net::windows::named_pipe`, name derived per-user (e.g. `\\.\pipe\nullnotes-<username>`), ACL restricted to the current user. A per-launch token written to a file in the app-data dir is required in every request; the CLI reads it from there. (Defence in depth: any local process of the same user could read the file, so this guards against other users and stale clients, not against same-user malware.)
- Request: `{ token, command, args }` (JSON, one line). Response: `{ ok, result }` or `{ ok:false, error }`, one line.
- **Dispatcher is a hand-written `match` over an allowlist**, calling the same `pub async fn` the Tauri command wraps, with managed state fetched from the `AppHandle` (`app.state::<DbPool>()`). Allowlist by construction: a command not in the `match` cannot be reached. No reflection, no "invoke by name".
- **Never exposed:** `code_run`, `code_format`, `editor_launch`/`open_note_externally`/`reveal_note`, `terminal`, `git_credentials`, `window`, and anything else that spawns a process or opens UI. Rule for new commands: default is *not* exposed; adding one is a deliberate `match` arm.
- Commands already take `workspace: String` as an argument, so the server holds no "current workspace" and concurrent requests for different workspaces need no extra state.

### Auto-launch

- If connecting fails, the CLI spawns `null-notes.exe --workspace=<ws> --headless` and retries the pipe for a bounded time (default 15 s), then exits with a distinct error code.
- `--headless` creates the main window with `visible: false`; a hidden window still loads the frontend, so `scan_workspace`/reindex/watcher behave normally.
- Add `tauri-plugin-single-instance` (not present today). A second launch — the user double-clicking the app — shows the existing window instead of starting another process.
- A CLI-started instance quits itself after an idle period (default 10 min of no pipe requests) **only if its window was never shown**. Once the user shows the window it is a normal session and is never auto-quit. The existing close-veto (flush unsaved edits) is bypassed only for a window that was never shown (no buffer to flush).

### Workspace resolution

1. `--workspace <path>` always wins.
2. Walk up from the current directory to the first directory that looks like a workspace. `git.rs::is_workspace_folder` already encodes this check; reuse it. Note `.workspace.json` is gitignored, so a fresh clone may not have one — the walk-up falls through rather than failing.
3. Otherwise the most recent entry in `recent-workspaces.json`.
4. Otherwise error (exit code, message names how to fix it).

### Output and exit codes

- JSON on stdout only; diagnostics on stderr. No human-readable format in v1 — the TUI is the human surface.
- Exit codes: `0` ok, `1` command failed (error JSON on stdout), `2` usage error, `3` workspace not resolved, `4` app unreachable after launch timeout, `5` write refused (dirty buffer — see below).

### Command surface (v1)

Verb-noun, mapped 1:1 to existing commands: `note list|read|create|append|rename|move|duplicate|delete(trash)`, `search`, `tags list`, `tag notes|rename`, `backlinks`, `links`, `tasks list|toggle`, `cards due|list|grade`, `folder create|rename`, `template list|create-from`, `trash list|restore`, `bookmarks`, `git status|commit|…`. Exact list and flags are the plan's job; the rule is "everything with an existing command and no process-spawn, no UI".

### Write safety

- CLI writes call the same `save_note`/`create_note`/`rename_note` the app uses, so `write_atomic` and the no-DB-work-on-save split hold. The CLI calls `reindex_note` after a write itself (it is not a keystroke path).
- The watcher already treats a file changed on disk as external: clean buffer reloads, dirty buffer prompts. The CLI never forces. If the app reports the target note has an unsaved buffer, the write fails with exit `5` and does not touch disk. (How the server learns about dirty buffers — it lives in the frontend — is the one real open mechanism; see below.)

## Settled in review

- Dirty-buffer writes are refused (exit 5), never forwarded to the conflict prompt.
- Trust boundary is the same user; the allowlist is the real control. Trash-delete is in v1; permanent delete, empty-trash and git push/pull/clone are not. `git status`/`commit` are in.
- First request per workspace per server session runs an incremental scan so search/backlinks are not stale; the plan measures its cost on a real workspace.
- Cross-workspace requests work (commands take `workspace`); the CLI triggers that workspace's scan/reindex. The app's watcher keeps covering only the workspace its window has open.
- Notes are addressed by workspace-relative, forward-slash path in input and output. Title lookup lives in `search` only.
- Content commands accept `--content -` (stdin) as well as inline; agent docs recommend stdin.
- Installer places `nullnotes.exe` beside `null-notes.exe` and adds that folder to the user PATH; the CLI finds the app exe beside itself, falling back to `target/` in dev.
- Every request carries an integer protocol version; mismatch returns a clear "update the CLI/app" error.
- CLI-started or CLI-targeted workspaces never enter `recent-workspaces.json` or the jump list.
- The server holds a per-path lock around each write command.
- Settings toggle "Allow CLI access", default on; when off the pipe server does not start and the CLI exits with a message saying so.
- At startup the app may re-launch itself under its MSIX identity (`register_and_relaunch`). The CLI waits for the pipe, never on the child process, and `--headless` must survive that relaunch.

## Decisions made by me (the user can override)

- Binary built as a second `[[bin]]` in `src-tauri`, not a new crate.
- Pipe name/token scheme, 15 s launch timeout, 10 min idle quit.
- Exit code numbering.

## Left to the builder

- **Dirty-buffer detection.** The backend does not know about frontend buffers: the frontend reports its dirty paths to the backend (small new command + state). A hidden, never-shown instance has no buffers, so writes always proceed there.
- Exact flag grammar (use `clap`, already idiomatic for Rust CLIs; it is not yet a dependency).
- Windows-only gating of the pipe/launch code (`cfg(windows)`), keeping mobile and web builds compiling.
- Tests: pipe server unit tests with an in-process client; one e2e spec via `e2e-verify` covering cold-start launch and a search round-trip.

## Later

- **TUI** (`nullnotes tui`): interactive browsing/search built on these same commands.
- **Live-UI commands** (open tab, active note, selection) over the same pipe.
- Docs: a `docs/cli.md` agent-facing reference, and a line in the user's agent instructions so Claude knows to use it.
