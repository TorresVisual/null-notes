# `nullnotes tui` — Design

Builds on [`cli-design.md`](cli-design.md), which deferred it ("the TUI is the human surface"). The CLI is shipped; this is the interactive front end for the person at the shell.

## Intent

`nullnotes tui` opens a full-screen terminal UI over a workspace: browse and read notes, search, triage tasks, review flashcards, capture a thought — without opening the GUI. It works with the app closed (the CLI's hidden-instance launch) and open. Typical places: Windows Terminal beside an IDE, or the app's own terminal pane.

## Goals

- **A pure client of the existing pipe.** Every read and write is an existing wire command from `COMMAND_TABLE`. No TUI-only server commands, no direct disk or `index.db` access. If the TUI and the GUI can disagree about what a write does, this has failed.
- **Keyboard-first, instant.** No keystroke waits on the pipe; all I/O is off the render thread.
- **Honest about the cold start.** A first request can take up to 15 s; the UI shows it, stays responsive, and Ctrl+C works.
- **Safe writes.** Writes inherit the CLI's rules: atomic save path, per-path lock, and a note with unsaved edits in the GUI is refused (`dirty_buffer`), never forced.

## Non-goals

- **Editing note bodies.** No in-TUI editor and no "open in `$EDITOR`" (v1). The second would spawn a process from a note-derived path; `src-tauri/src/commands/CLAUDE.md` makes that a deliberate, structurally-guarded decision, not a convenience. Capture covers the common write (below).
- Rendering ink, PDFs, canvases, diagrams, bases or the connections graph. Maths, mermaid and image blocks show as dim raw/placeholder lines.
- Running code, the terminal pane, git beyond a status indicator, permanent delete / empty trash.
- Live push updates. The pipe is request/response with no event stream; freshness is by refetch (below).
- Mouse, theming/config files, non-Windows, switching workspace inside the TUI (exit and pass `--workspace`).

## Anti-goals

- A second editor that quietly grows features the GUI lacks, or a second renderer of business rules (SM-2, link resolution, search ranking). The TUI displays what the server returns.
- Becoming slow enough that agents prefer `nullnotes search`. The TUI must not add startup cost to the non-TUI commands.

## Approaches

1. **Subcommand in the existing `nullnotes` crate (chosen).** `nullnotes tui` reuses `client.rs`, `workspace.rs`, `exit.rs` and the exit-code contract directly; adds `ratatui` + `crossterm` (+ `pulldown-cmark` for rendering) to `src-tauri/cli/`. One binary, already on `PATH` via the installer, already found next to `null-notes.exe`. Cost: a larger binary (~1–2 MB) and heavier dependency tree for what agents call; neither touches agent-call latency, since TUI code never runs unless asked.
2. **Separate `nullnotes-tui` crate/binary.** Keeps the agent binary lean, but needs the client split into a shared lib crate first — a refactor of just-shipped code to save a megabyte, plus a second installer entry. Rejected for now; revisit if the size ever matters.
3. **TUI inside the app (extend the terminal pane).** Wrong layer: the pane hosts any CLI, it doesn't render notes, and it would not work with the app closed.

Chosen: 1 (recommendation; not yet confirmed by the user — override freely).

## Design

### Entry

- `nullnotes tui [--workspace <dir>]`. Same workspace resolution and `--workspace` precedence as every CLI command (exit `3` if none).
- Bare `nullnotes` stays a usage error (exit 2): changing it would alter behaviour agents may already depend on.
- stdout/stdin not a TTY → exit `2` with a message; the TUI never runs under a pipe.
- Other exit codes follow the CLI table where they apply (`4` app unreachable, `6` access off, `7` version mismatch); clean quit is `0`.
- Terminal restored (raw mode off, alternate screen left) on every exit path including panic and Ctrl+C.

### Layout

```
┌ Null Notes · <workspace> ───────────────────── [git: main ±] ┐
│ 1 Notes  2 Search  3 Tasks  4 Cards  5 Tags  6 Trash          │
├──────────────────┬───────────────────────────────────────────┤
│ list / tree      │ preview (rendered note, backlinks below)  │
│                  │                                            │
├──────────────────┴───────────────────────────────────────────┤
│ status line: last result / error · key hints                  │
└───────────────────────────────────────────────────────────────┘
```

Below ~80 columns the preview collapses and `Enter` opens it full-width. Number keys `1`–`6` switch views; `?` shows keys; `q` / `Ctrl+C` quits (`Esc` backs out of a modal or sub-view first).

### Views (v1) and the wire commands behind them

| View | Does | Commands |
|---|---|---|
| Notes | folder tree built from workspace-relative paths, recency/name sort; preview with rendered markdown and a backlinks list; `Enter` on a `[[link]]` follows it | `note.list`, `note.read`, `backlinks` |
| Search | live FTS as you type (150 ms debounce), 20 per page with `n`/`p` via `--offset`; filters `tag:`, `folder:`, `block:`; `Ctrl+W` toggles all-workspaces (results then carry a workspace tag) | `search` |
| Tasks | open tasks grouped by note; `Space` toggles; `Enter` opens the note | `tasks.list`, `tasks.toggle` |
| Cards | review session over due cards: show front, `Space` reveals, `1`–`4` = again/hard/good/easy, `s` suspends; MC cards list options; end screen counts | `cards.due`, `cards.grade`, `cards.suspend` |
| Tags | tag list with counts; `Enter` lists the tag's notes | `tags.list`, `tags.notes` |
| Trash | entries with original path and age; `r` restores | `trash.list`, `trash.restore` |

Capture (`c`, from any view): a one-line prompt offering **Append to current note** (`note.append`) or **New note** (title prompt, folder defaults to the current note's folder; `note.create`). Single-line on purpose; longer text belongs to `nullnotes note create --content -`.

Delete/rename/move/duplicate, templates, properties, bookmarks and graph commands are not surfaced in v1: each is a straightforward later addition on the same pattern, none is needed to make the TUI worth opening.

### Note rendering

Client-side only, from the `note.read` markdown via `pulldown-cmark`: headings, emphasis, inline/fenced code, lists, task items (`[ ]`/`[x]`), block quotes, rules, links; `[[wiki-links]]` and `#tags` highlighted. Frontmatter shown as a dim header block. Tables, maths, mermaid and image/ink/PDF embeds fall back to dim raw text. Following a wiki-link resolves the title against the cached `note.list` (case-insensitive, as links resolve elsewhere); a miss shows "no such note" in the status line — it does not create one.

### Architecture

`src-tauri/cli/src/tui/`, split so the logic is testable without a terminal:

- **model + `update(state, msg) -> (state, effects)`** — pure. All behaviour (selection, debounce intent, stale-response handling, modal state) lives here.
- **`view(state, frame)`** — pure render with `ratatui`; tested against `TestBackend`.
- **effects runner** — one worker thread performing the blocking `client::request_with` calls, posting results back over an `mpsc` channel. The main loop selects over crossterm key events, worker results and a tick.
- Each request carries a monotonically increasing id per slot (search, preview, …); a result whose id is not the latest for its slot is dropped, so slow answers never overwrite newer input.
- The wire/exit-code types are reused from the CLI modules; the TUI adds no protocol of its own.

### Freshness and liveness

- Refetch the visible list on entering a view, after every TUI write, and on `Ctrl+R`. The open preview is re-read on selection and on `Ctrl+R`. No polling for edits made elsewhere.
- **Keepalive.** Any pipe request resets the hidden instance's 10-minute idle quit. While the TUI is open it issues a cheap `tags.list` every 5 minutes so the instance it started is not torn down underneath a user who is just reading. (My call; dropping it is harmless, the next request relaunches in 1–3 s but loses the warm scan.)
- On quit the TUI sends nothing; the instance idles out normally.

### Errors

Shown in the status line, never modal-blocking, and never auto-retried:

| Condition | Behaviour |
|---|---|
| `dirty_buffer` | "Unsaved edits in the app — nothing written"; the action's state is unchanged |
| `failed` / `usage` | message from the error body |
| app unreachable / access off / version mismatch | full-screen explanation (same text as the CLI's stderr) with `r` retry and `q` quit |

## Decisions made by me (the user can override)

- Approach 1 (subcommand, same crate); `ratatui`, `crossterm`, `pulldown-cmark` as the three new dependencies.
- The v1 view set and key map above; capture limited to append/new-note, single line.
- No `$EDITOR` hand-off in v1 (safety rationale above); no wiki-link auto-create.
- Bare `nullnotes` unchanged; TUI only via `nullnotes tui`.
- 5-minute keepalive; 150 ms search debounce; 80-column collapse threshold.

## Left to the builder

- Exact key bindings beyond those stated, and the help overlay's content.
- Whether `note.list` returns folders (it returns notes only): derive the tree from paths, accepting that empty folders do not appear, unless a wire command for folders is wanted — that would be a deliberate new allowlist arm, so raise it before adding one.
- Sort order and grouping details for Tasks and Tags.
- Card rendering for cloze (`{{…}}`) fronts and MC options, against `DueCard.kind`/`options`.
- Colour palette: 16-colour ANSI only, honouring `NO_COLOR`.
- **Tests.** `update` unit tests (stale-id dropping, `dirty_buffer` leaves state unchanged, debounce intent); `TestBackend` snapshots for each view and the narrow layout; a fake-pipe test reusing `client.rs`'s `fake_server` for one search round-trip. The raw-mode/terminal-restore path is manually QA'd, like PTY code elsewhere in this repo; one `e2e-verify` pass against a real workspace covers cold-start launch from inside the TUI.

## Later

- `$EDITOR` hand-off (needs the process-spawn review above), delete/rename/move, bookmarks, a links/graph view.
- Live-UI commands (jump the GUI to this note) once the CLI's live-UI spec exists.
- `docs/cli.md` gains a `tui` section; the agent-facing text should say agents do not use it.
