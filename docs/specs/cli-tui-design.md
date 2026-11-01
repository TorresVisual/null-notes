# `nullnotes tui` — Design

Builds on [`cli-design.md`](cli-design.md), which deferred it ("the TUI is the human surface"). The CLI is shipped; this is the interactive front end for the person at the shell. Every decision below was confirmed with the user in review unless it is listed under "Left to the builder".

## Intent

`nullnotes tui` opens a full-screen terminal UI over a workspace: browse and read notes, search, triage tasks, review flashcards, capture a thought — without opening the GUI. It works with the app closed (the CLI's hidden-instance launch) and open. It is a fast side-door for lookup, review and quick capture, not a replacement for the editor. Typical places: Windows Terminal beside an IDE, or the app's own terminal pane.

## Goals

- **A pure client of the existing pipe.** Every read and write is an existing wire command from `COMMAND_TABLE`. No TUI-only server commands, no direct disk or `index.db` access. If the TUI and the GUI can disagree about what a write does, this has failed.
- **Keyboard-first, instant.** No keystroke waits on the pipe; all I/O is off the render thread.
- **Honest about the cold start.** A first request can take up to 15 s; the UI shows it and stays responsive.
- **Safe writes.** Writes inherit the CLI's rules: atomic save path, per-path lock, and a note with unsaved edits in the GUI is refused (`dirty_buffer`), never forced.

## Non-goals

- **Editing note bodies.** No in-TUI editor and no "open in `$EDITOR`" in v1. The latter would spawn a process from a note-derived path; `src-tauri/src/commands/CLAUDE.md` makes that a deliberate, structurally-guarded decision that deserves its own small spec. Capture covers the common write.
- Rendering ink, PDFs, canvases, diagrams, bases or the connections graph. Maths, mermaid and image blocks show as dim raw/placeholder lines.
- Running code, the terminal pane, git (including any header indicator: `git.repo` returns only a repo mode, no branch or dirty state), permanent delete / empty trash.
- Live push updates. The pipe is request/response with no event stream; freshness is by refetch.
- Cross-workspace search, switching workspace inside the TUI (exit and pass `--workspace`).
- Mouse, theming/config files, non-Windows, legacy-conhost fallback.
- Delete/rename/move/duplicate, templates, properties, bookmarks and graph commands: each is a straightforward later addition on the same pattern; none is needed for v1 to be worth opening.

## Anti-goals

- A second editor that quietly grows features the GUI lacks, or a second renderer of business rules (SM-2, link resolution, search ranking). The TUI displays what the server returns.
- Adding startup cost to the non-TUI commands that agents call.

## Approaches

1. **Subcommand in the existing `nullnotes` crate (chosen).** `nullnotes tui` reuses `client.rs`, `workspace.rs`, `exit.rs` and the exit-code contract directly; adds `ratatui` + `crossterm` (+ `pulldown-cmark` for rendering) to `src-tauri/cli/`. One binary, already on `PATH` via the installer, already found next to `null-notes.exe`. Cost: a larger binary (~1–2 MB) and heavier dependency tree for what agents call; neither touches agent-call latency, since TUI code never runs unless asked.
2. **Separate `nullnotes-tui` crate/binary.** Keeps the agent binary lean, but needs the client split into a shared lib crate first — a refactor of just-shipped code to save a megabyte, plus a second installer entry. Rejected; revisit if size ever matters.
3. **TUI inside the app (extend the terminal pane).** Wrong layer: the pane hosts any CLI, it doesn't render notes, and it would not work with the app closed.

Chosen by the user: 1.

## Design

### Entry

- `nullnotes tui [--workspace <dir>]`. Same workspace resolution and `--workspace` precedence as every CLI command (exit `3` if none).
- Bare `nullnotes` stays a usage error (exit 2): changing it would alter behaviour agents may already depend on.
- stdin or stdout not a TTY → exit `2` with a one-line message; the TUI never draws into a pipe.
- Other exit codes follow the CLI table where they apply (`4` app unreachable, `6` access off, `7` version mismatch); clean quit is `0`.
- Terminal restored (raw mode off, alternate screen left) on every exit path including panic and Ctrl+C.
- Target terminals: Windows Terminal and modern conhost, Unicode box-drawing, 16-colour ANSI, `NO_COLOR` honoured. No ASCII fallback.

### Layout

```
┌ Null Notes · <workspace> ─────────────────────────────────────┐
│ 1 Notes  2 Search  3 Tasks  4 Cards  5 Tags  6 Trash          │
├──────────────────┬───────────────────────────────────────────┤
│ list / tree      │ preview (rendered note, backlinks below)  │
│                  │                                            │
├──────────────────┴───────────────────────────────────────────┤
│ status line: last result / error · key hints                  │
└───────────────────────────────────────────────────────────────┘
```

Below ~80 columns the preview collapses and `Enter` opens it full-width.

### Keys

- Move: arrows and `j/k/h/l`. `Tab` switches list ↔ preview. `Enter` opens or follows; `Esc` backs out of a modal or sub-view first. `/` opens search. `1`–`6` switch views. `c` capture. `Ctrl+R` refresh. `?` help. `q` / `Ctrl+C` quits.
- **While a text input is focused (search, capture) every key goes to the input**; only `Esc` and `Enter` are special. This is what keeps typing a `q` from quitting.
- Exact bindings beyond these are the builder's.

### Views (v1) and the wire commands behind them

| View | Does | Commands |
|---|---|---|
| Notes | folder tree built from workspace-relative paths; preview with rendered markdown and a selectable backlinks list; `Enter` on a `[[link]]` or backlink follows it | `note.list`, `note.read`, `backlinks` |
| Search | live FTS as you type (150 ms debounce), 20 per page, `n`/`p` page via `--offset`; inline filters `tag:x`, `folder:x`, `block:x` parsed client-side from the one input and sent as `--tag`/`--folder`/`--block-type`; an unrecognised `word:` stays part of the query. Searches the resolved workspace only | `search` |
| Tasks | open tasks grouped by note; `Space` toggles; `Enter` opens the note. A completed task stays visible, struck through, until the view is re-entered or refreshed, so a second `Space` reopens it | `tasks.list`, `tasks.toggle` |
| Cards | review session over due cards: show front, `Space` reveals back, `1`–`4` = again/hard/good/easy, `s` suspends. MC cards show their options for context and are **self-graded** like any other card — the wire has no "answer this option" command and `DueCard` deliberately omits the correct one. End screen counts | `cards.due`, `cards.grade`, `cards.suspend` |
| Tags | tag list; `Enter` lists the tag's notes | `tags.list`, `tags.notes` |
| Trash | entries with original path and age; `r` restores | `trash.list`, `trash.restore` |

**Notes tree gap:** `note.list` returns notes only, so empty folders do not appear. Accepted; a folders command would be a deliberate new allowlist arm, raised only if it bites.

**Capture** (`c`): a single-line prompt offering **Append to current note** (`note.append`) or **New note** (title prompt; `note.create`). Append targets the selected/previewed note in Notes, Search and Tasks; in Cards, Tags and Trash no note is in focus, so append is disabled with a status-line hint. New note is available everywhere, in the focused note's folder if there is one, else the workspace root; afterwards the TUI jumps to it in Notes. Longer text belongs to `nullnotes note create --content -`.

### Note rendering

Client-side only, from the `note.read` markdown via `pulldown-cmark`: headings, emphasis, inline/fenced code, lists, task items (`[ ]`/`[x]`), block quotes, rules, links; `[[wiki-links]]` and `#tags` highlighted. Frontmatter shown as a dim header block. Tables, maths, mermaid and image/ink/PDF embeds fall back to dim raw text. Following a wiki-link resolves the title against the cached `note.list` (case-insensitive, as links resolve elsewhere). A miss shows "no such note" in the status line and **creates nothing** — the GUI creates on click, but a TUI keypress that writes a file is too easy to hit by accident.

### Architecture

`src-tauri/cli/src/tui/`, split so the logic is testable without a terminal:

- **model + `update(state, msg) -> (state, effects)`** — pure. All behaviour (selection, debounce intent, stale-response handling, modal state, error handling) lives here.
- **`view(state, frame)`** — pure render with `ratatui`; tested against `TestBackend`.
- **effects runner** — one worker thread performing the blocking `client::request_with` calls, posting results back over an `mpsc` channel. The main loop selects over crossterm key events, worker results and a tick.
- Each request carries a monotonically increasing id per slot (search, preview, …); a result that is not the latest for its slot is dropped, so slow answers never overwrite newer input.
- The wire and exit-code types are reused from the CLI modules; the TUI adds no protocol of its own.

### Freshness, liveness, cold start

- Refetch the visible list on entering a view, after every TUI write, and on `Ctrl+R`. The open preview is re-read on selection and on `Ctrl+R`. No polling for edits made elsewhere (GUI or agent edits appear on refresh).
- **Keepalive.** Any pipe request resets the hidden instance's 10-minute idle quit. While the TUI is open it issues a cheap `tags.list` every 5 minutes so the instance it started is not torn down under a user who is just reading.
- **Cold start.** While the first request blocks (up to 15 s), the UI shows a "Starting Null Notes…" splash and stays responsive. Ctrl+C quits immediately; the TUI does not try to stop the instance it triggered, which idles out after 10 minutes like any CLI-started one.
- On quit the TUI sends nothing.

### Errors

Shown in the status line, never modal-blocking, never auto-retried:

| Condition | Behaviour |
|---|---|
| `dirty_buffer` on a write | "Unsaved edits in the app — nothing written"; state unchanged. In a card session the card stays due, is skipped, and the session continues; a refused task toggle leaves the task as it was |
| `failed` / `usage` | message from the error body |
| app unreachable / access off / version mismatch | full-screen explanation (same text as the CLI's stderr) with `r` retry and `q` quit |

## Decisions made by me (the user can override)

None outstanding: every item in this spec was put to the user and confirmed. The tuning numbers (150 ms debounce, 80-column collapse, 5-minute keepalive) are defaults the builder may adjust.

## Left to the builder

- Key bindings beyond those stated, and the help overlay's content.
- Sort order and grouping for Notes, Tasks and Tags.
- Card rendering for cloze (`{{…}}`) fronts and MC options, against `DueCard.kind`/`options`.
- Colour palette within 16-colour ANSI.
- **Tests.** `update` unit tests (stale-id dropping, `dirty_buffer` leaves state unchanged and skips a card, debounce intent, task struck-through-then-reopen); `TestBackend` snapshots for each view and the narrow layout; a fake-pipe test reusing `client.rs`'s `fake_server` for one search round-trip. No e2e: `e2e-verify` drives the GUI through WebdriverIO and cannot drive a terminal UI. Instead a manual QA checklist, recorded in the plan: cold start from a closed app; a search round-trip; grading a card; toggling a task; terminal restored after Ctrl+C and after a forced panic; `NO_COLOR`.

## Later

- `$EDITOR` hand-off (needs its own process-spawn review), delete/rename/move, bookmarks, a links/graph view, a folders wire command, a git branch/dirty indicator once a wire command returns it, cross-workspace search.
- Live-UI commands (jump the GUI to this note) once the CLI's live-UI spec exists.
- `docs/cli.md` gains a `tui` section; its agent-facing text should say agents do not use it.
