---
name: bug-hunter
description: Hunt for bugs in null-notes by actually using the compiled app in adversarial ways (odd input, rapid actions, external file edits, awkward paths, lifecycle edge cases) and seeing whether it breaks. On a confirmed bug, files a GitHub issue via file-issue, then asks whether to fix it now or end the session. Keeps persistent notes (coverage, findings, harness learnings) so later sessions don't repeat themselves. Use when the user says "bug hunt", "hunt for bugs", "try to break the app", "find bugs by using it", "exploratory test", or "/bug-hunter" — even if they don't name a feature area.
---

# Bug hunter

Exploratory testing of the real app. Unit tests check what someone thought of; this looks for what nobody did. Each session should leave notes behind so the next one starts where this one stopped instead of re-poking the same corners.

## Rules

- **Hunt, don't fix** — until the user picks "fix now" at the checkpoint below. No source edits, no commits of product code while hunting.
- **Never touch the user's real workspace or `%APPDATA%\dev.nullnotes.app`.** Drive the app only against the fixture workspace (`e2e/fixtureWorkspace.ts`, opened via `--workspace=<path>`, which doesn't touch `recent-workspaces.json`).
- **A bug is only a bug once it reproduces twice** and you can state expected vs. actual. One-off failures are driver noise (see `e2e-verify` gotchas); a failure that survives retry is real.
- **Don't file what's already known:** open/closed GitHub issues, `docs/ROADMAP.md` §7 (out of scope) and §8 (polish backlog), and `.claude/bug-hunter/FINDINGS.md`. PDF-to-Markdown conversion bugs go to the `pdf-bug-triager` agent first.

## Notes (persistent memory)

```text
.claude/bug-hunter/
├── COVERAGE.md   areas/charters tried: date, commit, what was done, outcome (clean / bug #N)
├── FINDINGS.md   every bug found: issue number, one-line repro, status, area
└── LEARNINGS.md  how to hunt here: harness tricks, flaky spots, techniques that found bugs, dead ends
```

Create the directory and files on the first run; keep entries to a line or two. Read all three **before choosing what to hunt**. Write to them **as you go** (after each charter and each finding), not only at the end — sessions get cut off, and an unwritten note is a lost note. If a note contradicts what you observe, the app wins; fix the note.

## Session flow

1. **Orient.** Read the notes. `git log --oneline -15` and `git diff --stat <last-hunted-commit>..HEAD` against what COVERAGE.md recorded. Pick charters in this order: areas touched by recent commits → areas never hunted → areas that previously had bugs (they cluster) → re-probe stale "clean" areas.
2. **Pick a charter** — one area and one angle, e.g. "rename a note while it's open with unsaved edits". Say it in one line before starting. Prefer 3–5 small charters over one sprawling one.
3. **Hunt** (see below). Write the probe as a throwaway `e2e/specs/hunt-<charter>.e2e.ts`; follow `e2e-verify` for launching, in-page clicks, native-dialog handling, and debounce-aware waits. Run with `npm run test:e2e -- --spec e2e/specs/hunt-<charter>.e2e.ts`.
4. **Judge.** Check *disk* (the `.md` and sidecars are the source of truth, not React state), the on-screen result (`screenshot()` — open the PNG for the user rather than reading it into the conversation, per `e2e-verify`), and the webview console for errors. Silent data loss, a crash, a hang, corrupted Markdown on round-trip, or a false conflict prompt are all bugs even if no assertion screams.
5. **On a finding → the checkpoint** (below). On a clean charter → record it in COVERAGE.md and move on.
6. **End of session:** delete throwaway `hunt-*` specs (unless the user wants one kept as a regression test), make sure the notes are current, and give a short report: charters run, bugs found with issue numbers, what to hunt next.

## Where bugs hide here

Start from the invariants the codebase already declares — breaking one is a bug by definition:

- **Save path** (root `CLAUDE.md`): type, then kill/close mid-debounce; type during a save; a half-written `.md` after interruption; `save_note` doing DB work; reindex lagging behind (tags/links/FTS stale after edit).
- **Watcher/conflicts:** normal typing must *not* raise a conflict; an external edit to a clean note reloads, to a dirty one prompts; our own write echoing back; external create/rename/delete of the open note or its sidecar.
- **Round-trip:** type content → save → reopen → compare. Every node type with its own markdown serializer (tables, callouts, math, mermaid, wiki-links, tasks, footnotes, code blocks) — nested, empty, adjacent to each other, with special characters (`|`, `*`, `$`, backticks, `[[`, trailing spaces, CRLF).
- **Paths:** spaces, unicode, very long names, `#`/`%`/`&` in note, folder, and sidecar names (`Lecture 7.assets/`); rename or move a note with ink/pdf/diagram/assets sidecars; links and embeds afterwards.
- **Lifecycle:** create/rename/move/delete/trash/restore while the note is open, in a split pane, in a backlink, or in a search result; empty workspace; note with no title or frontmatter that doesn't parse (properties edits must refuse, not mangle).
- **Stress:** rapid keystrokes and undo/redo storms, very large notes, hundreds of notes, long lines, many tabs, resize to tiny windows, fast tab switching during save.
- **Outside doors:** the `nullnotes` CLI against a live app (`src-tauri/src/commands/CLAUDE.md` "The CLI pipe"), bad arguments, concurrent edits from CLI and UI.
- **Subsystem seams:** ink ↔ note save, diagrams, Bases/canvas files, flashcards/cram, templates/snippets, export/print.

Cheap techniques: boundary values (empty, one, huge), the same action twice, an action while another is in flight, undo right after, reopen the app and check state survived, and compare with how the same action behaves one pane/tab over.

Harness limits: `@tauri-apps/plugin-dialog` confirm/message dialogs can't be driven (`e2e-verify`), so flows behind them (e.g. delete confirmations) need another route — note it in LEARNINGS.md instead of burning time. For pure CSS/layout probing without a Tauri build, `ui-preview` is lighter.

## The checkpoint (when a bug is confirmed)

1. Minimize the repro to the fewest steps; note the exact commit (`git rev-parse --short HEAD`).
2. Record it in FINDINGS.md (status `found`) so it survives even if the filing step is interrupted.
3. Duplicate check: `gh issue list --repo TorresVisual/null-notes --search "<terms>" --state all`. If it's a duplicate, add the new repro detail as a comment only if the user okays it; don't file a second issue.
4. File via the `file-issue` skill — it investigates the code, shows a draft, and waits for approval before `gh issue create`. Hand it: symptom, minimal repro steps, expected vs. actual, what disk/console showed, and a severity argument (data loss or crash = `high`). Update FINDINGS.md with the issue number when filed.
5. Then ask the user with AskUserQuestion, with these options:
   - **Fix it now** — switch to `superpowers:systematic-debugging` (root cause, not symptom), add a regression test (keep the hunt spec as an e2e test if it's the best regression guard), commit per the global commit rule referencing the issue (`Fixes #N`), mark FINDINGS.md `fixed`, then ask again.
   - **Keep hunting** — continue with the next charter.
   - **End the session** — go to step 6 of the session flow.

   Asking every time matters: the user decides how much of the session goes to fixing versus finding. Don't auto-continue past a finding and don't auto-fix.

## Note formats

COVERAGE.md — newest first, one line each:
`2026-11-01 @abc1234 · rename-while-dirty · clean` / `· bug #123`

FINDINGS.md — table: `# | area | repro (one line) | commit found | status (found/filed/fixed/wontfix)`

LEARNINGS.md — short bullets under headings *Harness*, *Techniques that found bugs*, *Dead ends*, *Flaky (not bugs)*. Add a bullet whenever you lose more than a few minutes to something a future session could skip.
