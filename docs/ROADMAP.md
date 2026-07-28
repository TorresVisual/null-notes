# null-notes — Product & Technical Roadmap

**Last updated:** 2026-07-27 (Phase 0 implemented; M0 awaits its real-use soak)
**Audience of this doc:** the maintainer (solo dev).
**Product audience:** you — a personal, offline, daily-driver note app for CS coursework. This is **not** aimed at public distribution yet, which deliberately pushes packaging, cross-platform, auto-update, branding, and onboarding *down* the priority list. Correctness, data integrity, and the editor/ink/PDF workflow come first.

---

## How to read this

- Phases are **ordered by dependency and value**, not by calendar. As a solo project the useful unit is "what unblocks the next thing," so tasks carry an effort size (**S** ≈ hours, **M** ≈ a day or two, **L** ≈ several days) instead of dates.
- Each phase has a **milestone (Mn)** with a one-line "you can now…" definition. Ship a phase only when its milestone is true.
- Every task has a **Definition of Done (DoD)** — objective and checkable. If the DoD isn't met, the task isn't done.
- **Cut / challenged features** are collected in their own section with reasoning, per the brief's mandate to remove low-value work.
- **Out of scope** at the end is a hard boundary — things intentionally *not* being built, to prevent scope creep.

---

## 1. Product vision

> A Markdown-first, WYSIWYG desktop note app for a CS student who writes math and code daily, sketches diagrams by hand with a stylus, and never wants their notes locked into a proprietary format.

**Non-negotiable principles (already honored by the architecture — keep them):**

1. **Plain `.md` is the source of truth.** SQLite is a rebuildable index; deleting it loses nothing. Never invert this.
2. **Offline-first, local-first.** No cloud dependency to open a note.
3. **The file on disk is always safe.** No edit path may silently lose or corrupt a note.
4. **Small, sharp feature set.** Three similar things is not a pattern; don't scaffold half-features.

---

## 2. Current-state audit

The project is **substantially further along than a greenfield app** — ~3,500 lines of TS/TSX, ~1,900 lines of Rust, real test coverage on the backend and on pure frontend logic, and eight completed design→plan cycles in `docs/`.

### What is solid and shippable today

| Area | State | Evidence |
|---|---|---|
| Note lifecycle (create/open/save/delete/move) | Complete, tested | `src-tauri/src/commands/notes.rs` |
| Folder ops (create/rename/delete cascade) | Complete, tested | `notes.rs:362-419`, `folder_tests` |
| Full-text search (SQLite FTS, `Ctrl+K`) | Complete | `search_notes`, `SearchModal.tsx` |
| Tags (`#tag`) + tag browser/filter | Complete, tested | `extract_tags`, `TagList.tsx` |
| Wiki-links + backlinks panel | Complete (with one gap, below) | `WikiLink.tsx`, `BacklinksPanel.tsx` |
| WYSIWYG editor: tables, tasks, code highlighting, KaTeX (inline+block), Mermaid, callouts, slash commands | Complete | `src/editor/extensions/` |
| Ink: pen/eraser/shapes, pressure, palm rejection, eraser hit-testing, canvas preview | Complete, tested | `src/ink/`, `InkBlock.ts` |
| Visual design system ("Terminal Precision" tokens, icon set) | Complete | git log `2f72238`, `43a95c6` |
| Per-workspace session persistence (open tabs, expanded folders) | Complete | `workspace.ts`, `.workspace.json` |

The editor and ink subsystems are the mature heart of the app. **They do not need more features to be a daily driver — they need the surrounding reliability layer.**

### What is a skeleton (looks done, isn't)

- **PDF import pipeline.** Wired end-to-end in code but non-functional in practice:
  - PDF rendering is behind an **optional, off-by-default** Cargo feature (`pdf-native`), so a default build fails with *"PDF rendering requires the pdf-native feature"* (`src-tauri/src/pdf/renderer.rs:5-14`).
  - OCR shells out to an **external `tesseract` binary** that must be on `PATH` (`pdf/ocr.rs:14`); nothing installs or bundles it.
  - Equation recovery shells out to a **pix2tex venv** (~500 MB model) set up manually via `scripts/` (`pdf/equations.rs`).
  - **The bounding boxes are degenerate.** `ocr_page` returns every line with `x:0, y:0, w:1.0, h:0.0` (`pdf/ocr.rs:30-38`), so the equation-crop step crops a **zero-height region** — equation localization cannot work as written. This is the single biggest gap between the spec's promise and reality.
  - Net: PDF import is a research prototype, not a feature. See the explicit **decision fork in Phase 3**.

### Confirmed risks / defects (independently verified in code)

1. **Autosave writes on every keystroke with no debounce.** `NoteEditor.onUpdate` → `onChange` → `useNote.save` fires on each edit (`NoteEditor.tsx:30-33`, `useNote.ts:18-25`). Every keystroke = a full file write **plus** a full SQLite reindex of content (FTS), tags, and links (`save_note`, `notes.rs:201-236`). This is a latency and disk-churn problem that will get worse with long notes, and it couples typing latency to DB work.
2. **Save failures are silent.** `save()` awaits `api.notes.save` and discards errors; there is no dirty indicator, no "unsaved"/"save failed" state, no retry. A failed write (disk full, permission, path moved) is invisible → **perceived data loss**. Violates principle #3.
3. **No external-change awareness.** The workspace is scanned only on open. Editing a `.md` in another editor, a `git pull`, or Syncthing landing a change will not refresh the tree, and the FTS index silently goes stale. For a plain-files app this is a correctness gap.
4. **Unresolved wiki-links are dead ends.** Clicking `[[Note That Doesn't Exist]]` does nothing (`WikiLink.tsx:18-20`). The classic "click to create the note" affordance is missing — a real friction point for note-linking workflows.
5. **Wiki-link/backlink resolution is by title string only.** Two notes sharing a title are ambiguous; renaming a note's heading silently breaks inbound links. Acceptable for now, but a known sharp edge.
6. **Note `id` is non-stable.** A fresh `Uuid::new_v4()` is minted on every scan/save (`notes.rs:159`, `213`, `257`). `path` is the real key; `id` is effectively decorative. Fine today, but don't build anything on `id`.
7. **App identity is boilerplate.** `productName: "tauri-app"`, `identifier: com.moritz.tauri-app`, default 800×600 window, template README (`tauri.conf.json`, `README.md`). Cosmetic for personal use, but trivially fixable and currently makes the app feel unfinished.
8. **No settings/preferences surface** and **no native app menu** — every capability lives behind an in-app button or a single hardcoded shortcut (`Ctrl+K`).

---

## 3. Prioritization framework

Given "personal daily driver," priority = **`(daily-use value) × (risk of data loss or friction) ÷ effort`**. Reliability beats new features; new features beat polish; polish beats distribution; distribution is out of scope for now.

| Phase | Theme | Milestone | Why it's here |
|---|---|---|---|
| **P0** | Trustworthy daily driver | **M0:** I trust it with my real notes | Data-integrity + save-path risks block everything |
| **P1** | Everyday-use completeness | **M1:** I don't reach for another app | Small gaps that break flow (links, refresh, quick-switch) |
| **P2** | Feel & ergonomics | **M2:** it's a pleasure to use for hours | Compounding daily quality-of-life |
| **P3** | Headline features & power tools | **M3:** the CS-specific superpowers land | PDF decision, export, graph — high value, higher effort |
| **P4** | Future / stretch | **M4:** AI + code execution (gated) | Explicitly deferred; do not let it pull focus |

---

## Phase 0 — Trustworthy Daily Driver (P0) 🔴 blocking

**Milestone M0:** *I can use this as my only note app for a week without fear of losing or corrupting a note.*

**Status (2026-07-27):** P0-1…P0-5 are implemented and their DoDs are met in code and tests — commits `beffda5` (P0-1…P0-4) and `fe22aaa` (P0-5). **M0 itself is not signed off:** its exit check requires a several-day real-use soak, which is a human activity, not a code change.

Nothing else matters until M0 is true. These are all reliability/data-integrity items.

### P0-1 — Debounced autosave with explicit save state — **M** ✅
Decouple typing from disk/DB work and make save status visible.
- Debounce writes (e.g. 500–800 ms idle) in `useNote`; flush pending write on tab switch, workspace switch, and `beforeunload`.
- Track document state: `clean | dirty | saving | error`.
- **Dependency:** none. First task in the project.
- **DoD:**
  - Typing a 5,000-word note shows no per-keystroke disk write (verify via a write counter / log).
  - Switching tabs or closing the window flushes any pending edit before unload (no lost trailing keystrokes).
  - A visible indicator reflects `dirty`/`saving`/`saved`.
  - Existing tests pass; a new `useNote` test covers "debounce coalesces rapid edits into one save" and "flush-on-unmount writes pending content."

*Done: `useNote` runs a `clean|dirty|saving|error` machine, coalescing edits into one write after 600 ms idle; pending writes flush on tab switch, unmount and window close (Rust vetoes `CloseRequested`, the UI flushes, then `confirm_close` destroys the window). Covered by `useNote.test.ts`.*

### P0-2 — Surface save failures — **S** ✅
Never fail a write silently again (principle #3).
- On save rejection, set `error` state, keep the buffer dirty, and show a non-blocking, dismissible error with a retry.
- **Dependency:** P0-1 (shares the state machine).
- **DoD:** Simulating a rejected `save_note` (e.g. read-only path) surfaces a visible error and the in-memory edit is preserved (not discarded); a test asserts the buffer stays dirty on failure.

*Done: a failed write keeps the buffer dirty and surfaces a tab-bar chip with retry; dismissing the message leaves the note showing "Unsaved", never "Saved".*

### P0-3 — Split the "index" write off the "save" write — **M** ✅
Typing latency must not depend on FTS/tags/links reindexing.
- `save_note` currently does file write **and** four DB operations in one command (`notes.rs:201-236`). Make the file write the authoritative, fast path; move/allow the index update to run after (or debounce it more coarsely than the file write).
- **Dependency:** P0-1.
- **DoD:** The file on disk is updated on the fast debounce; search/tags/backlinks reindex may lag by design but is guaranteed to catch up before the tab is closed. A test confirms content is searchable after a save+settle cycle.

*Done: `save_note` writes only the file; `reindex_note` carries the FTS/tag/link work on a lazier 2.5 s debounce and is flushed before the tab closes.*

### P0-4 — Crash-safe writes — **S** ✅
Avoid truncated files if the app dies mid-write.
- Write to a temp file in the same directory and atomically rename over the target (`notes.rs` `save_note`, `create_note`).
- **Dependency:** none (can land alongside P0-1).
- **DoD:** Killing the process during a large save never leaves a zero-byte or half-written `.md`; a Rust test writes-then-renames and asserts the target is either fully old or fully new.

*Done: `write_atomic` (temp file + fsync + rename) backs both `save_note` and `create_note`; tests assert the target survives a failed write and no temp files are left behind.*

### P0-5 — External-change refresh — **M** ✅
Keep the tree and index honest when files change underneath the app.
- Watch the workspace directory (Tauri fs-watch / `notify` crate). On change: refresh the tree, re-index changed files, and reload the active note if it changed on disk and the buffer is clean. If the buffer is **dirty** and the file changed externally, surface a conflict prompt (keep mine / reload theirs) — do **not** auto-overwrite.
- **Dependency:** P0-1/P0-2 (needs the dirty-state machine to resolve conflicts safely).
- **DoD:** Editing a `.md` in an external editor updates the sidebar title and search within ~1 s; an external change to the open, unmodified note reloads it; an external change to a dirty note prompts instead of clobbering.

*Done: `watch_workspace` (notify, 300 ms debounce) emits `workspace-changed`; `reindex_from_disk` re-reads changed files and forgets externally deleted ones; a clean buffer follows the disk, a dirty one gets the conflict bar (keep mine / reload theirs).*

**Exit check for M0:** P0-1…P0-5 DoD all met ✅; a manual "use it for real for several days" soak with no data-loss incident — **outstanding, and the only thing between here and M0.** Keep the "annoyances during real use" list from that soak; P2-3 clears it.

---

## Phase 1 — Everyday-Use Completeness (P1)

**Milestone M1:** *The small gaps that make me switch back to another app are gone.*

### P1-1 — Create-note-from-unresolved-wiki-link — **S** ✅
- Clicking a `[[missing]]` link creates the note (in the active/selected folder), opens it, and resolves the link. Style resolved vs. missing already exists (`wiki-link-missing`).
- **Dependency:** none.
- **DoD:** Clicking an unresolved link creates `Missing.md` seeded with `# Missing`, opens it in a tab, and the link renders as resolved without a manual refresh.

*Done: a `useCreateNote` hook (shared with the sidebar's new-note button) creates the note in the selected folder, adds it to the store — which re-resolves the link on the next render — and opens it. Filenames are derived from titles, so `create_note` now refuses to write over an existing file rather than silently destroying it; the collision surfaces in the error banner. Covered by `useCreateNote.test.ts` and three `create_note_file` tests.*

### P1-2 — Quick-switcher / recent workspaces — **M** ✅
Right now switching workspaces means re-picking a folder every time; there's no jump-to-note.
- Persist a **recent workspaces** list; offer a picker instead of only the OS folder dialog.
- Extend `Ctrl+K` (or add `Ctrl+P`) to jump to a note by title across the current workspace, keyboard-navigable.
- **Dependency:** none.
- **DoD:** Reopening the app offers the last workspaces without a folder dialog; `Ctrl+P` opens any note by fuzzy title in ≤3 keystrokes for a typical name.

*Done: the backend keeps an app-data-dir `recent-workspaces.json` (most-recent-first, capped at 8); `WorkspacePicker` replaces the empty state with that list plus a folder-dialog fallback, and filters out workspaces that no longer exist without forgetting them. `Ctrl+P` opens `QuickSwitcher`, which ranks the in-memory notes list by title-match position (prefix beats mid-title) with no backend round-trip. Covered by `workspace.rs`'s recents tests, `pathPrefix.test.ts`, `useCreateNote`-adjacent store tests, and `QuickSwitcher.test.ts`.*

### P1-3 — Note rename that preserves links — **M**
Today "title = first heading" and there's no note rename; renaming a heading silently breaks inbound `[[links]]` (risk #5).
- Provide an explicit rename (heading + optionally filename) that rewrites inbound wiki-link targets across the workspace, or records an alias.
- **Dependency:** P1-1 (link machinery), P0-5 (index refresh).
- **DoD:** Renaming a note updates every inbound `[[old]]` to `[[new]]` (or preserves resolution via alias); a backend test covers the cascade, mirroring the existing folder-rename test.

### P1-4 — Delete/close UX safety — **S**
- Confirm destructive folder/note deletes (folder delete is a recursive `remove_dir_all`, `notes.rs:376-381`). Confirm closing a tab with unsaved (should be impossible after P0-1, but guard anyway).
- **Dependency:** P0-1.
- **DoD:** Deleting a non-empty folder requires confirmation naming the count of affected notes; no delete path is a single misclick.

### P1-5 — App identity cleanup — **S** ✅
Cheap, removes the "unfinished template" feel.
- Set `productName`, `identifier`, window title/size defaults, app icon; rewrite `README.md` to describe null-notes (it's currently the Tauri template readme).
- **Dependency:** none.
- **DoD:** Built app shows "null-notes" everywhere; README documents what the app is, how to run it, and the storage model.

*Done: `productName`/`identifier`/window title are "null-notes" / `dev.nullnotes.app`, default window grew from the template's 800×600 to 1280×800; the Cargo package and lib crate are renamed (`null-notes` / `null_notes_lib`) and `package.json` follows. README rewritten to describe the app, storage model, and run/build commands. App icon left as Tauri's generic default — swapping it needs an actual icon asset, not a code change, so it's deferred rather than silently done.*

**Exit check for M1:** links never dead-end, jumping around is fast, renames don't break references, and the app no longer looks like a template.

---

## Phase 2 — Feel & Ergonomics (P2)

**Milestone M2:** *Long editing sessions feel good; nothing fights me.*

The visual-design and editor-feel passes are already done (`docs/plans/visual-design-system.md`, `editor-feel.md`). This phase is the remaining ergonomics layer.

### P2-1 — Settings / preferences surface — **M**
- A minimal settings panel: theme (if more than one), editor max-width/typography, autosave debounce interval, default workspace, spellcheck toggle. Persist to a config file (not SQLite — SQLite is a rebuildable index).
- **Dependency:** P0-1 (autosave interval becomes a setting).
- **DoD:** Changing a setting persists across restarts and takes effect without a reload where feasible.

### P2-2 — Keyboard-shortcut layer + native menu — **M**
- A native app menu (File/Edit/View) and a discoverable shortcut sheet. Wire the actions that already exist (new note, new folder, search, toggle raw/WYSIWYG, insert ink).
- **Dependency:** P1-2 (quick-switcher shortcut should be registered here too).
- **DoD:** Every primary action has a keyboard path; a `?`/shortcut overlay lists them; menu items work.

### P2-3 — Editor niceties audit — **S/M**
- Spellcheck toggle, drag-to-reorder or at least stable list behavior, paste-image-into-note handling, and a pass on focus/scroll restoration when switching tabs.
- **Dependency:** none.
- **DoD:** A short checklist of "annoyances during real use" (maintained during the M0 soak) is cleared.

### P2-4 — Empty/onboarding states — **S**
- The current empty state is one line ("Open a workspace and select a note"). Add a friendly first-run: pick/create a workspace, create your first note, a hint at `Ctrl+K`/`Ctrl+P`.
- **Dependency:** P1-2.
- **DoD:** A brand-new user (or a fresh workspace) has an obvious next action at every step.

---

## Phase 3 — Headline Features & Power Tools (P3)

**Milestone M3:** *The CS-specific superpowers that justify a custom app are real.*

### P3-1 — PDF import: **decision fork** (do this first in P3) — **decision, then L**

The current pipeline is a broken skeleton with heavy external dependencies (audit §2). Per the brief's mandate to challenge low-value work, **do not "finish" it by default.** Choose one:

- **Option A — Descope to "PDF as reference" (recommended).** Import a PDF as an attachment and render its pages alongside the note (or into image blocks) so you can transcribe/annotate manually. No OCR, no pix2tex, no tesseract, no 500 MB model, no bundling headache. Delivers ~80% of the daily value (having the sheet next to your solution) for ~20% of the effort, and is fully offline with zero external binaries.
  - **DoD (A):** Drag-drop or "Import PDF" turns the default `pdf-native` feature **on** (or replaces pdfium with a lighter render path), renders pages to images stored beside the note, and inserts them as viewable blocks. No dependency on `tesseract`/pix2tex. Works in a default `cargo build`.
- **Option B — Actually build the OCR→LaTeX pipeline.** Only if automated exercise extraction is a must-have. Requires: real per-word bounding boxes (tesseract TSV output, not `--psm 1` line text — fixes the degenerate-bbox defect at `pdf/ocr.rs:30-38`), reliable region grouping, bundling or first-run-installing tesseract + pix2tex, and the exercise-boundary heuristic from `docs/specs/tech-stack-design.md`. This is an **L+ research effort** with an accuracy ceiling; treat it as a spike with a go/no-go gate, not a committed feature.
  - **DoD (B):** A 20-page typeset sheet imports in <10 s (spec target) into `ExerciseBlock`s with editable extracted text and best-effort LaTeX, on a machine set up by a documented one-command installer; failure modes degrade to plain text, never crash.

**Recommendation:** Ship **Option A** now; keep **Option B** as an optional spike behind a feature flag. Don't block M3 on B.

### P3-2 — Export (print / PDF / HTML) — **M**
High daily value for a student (submitting or sharing notes) and currently absent.
- Export the active note (and its rendered ink/math/mermaid) to PDF and/or standalone HTML. Leverage the WebView's print pipeline where possible.
- **Dependency:** none (but nicer after P2 typography settings).
- **DoD:** A note with math, a code block, a Mermaid diagram, and an ink block exports to a PDF that visually matches the editor.

### P3-3 — Knowledge graph / connections view — **M/L**
The data already exists (`note_links`, backlinks). A local graph of notes↔links↔tags is a natural, high-value power feature for revision.
- **Dependency:** P1-1/P1-3 (link integrity), P0-5 (fresh index).
- **DoD:** A view renders notes as nodes and `[[links]]`/shared tags as edges; clicking a node opens the note; it stays responsive at a few hundred notes.

### P3-4 — Manual sync guidance, done well — **S**
Sync is out of scope as a *feature* (principle #2), but since files are plain `.md`, make Git/Syncthing painless.
- A sensible `.gitignore` (index.db, tmp, ink temp), docs on the recommended sync setup, and — after P0-5 — graceful handling of files appearing/changing from a sync client.
- **Dependency:** P0-5.
- **DoD:** A documented Git-based sync round-trip (edit on machine A, pull on machine B) works without index corruption or manual re-scan.

---

## Phase 4 — Future / Stretch (P4) — explicitly gated

**Milestone M4:** *Only after M0–M3 are solid.* These are the v2 vision from `docs/specs/tech-stack-design.md`, kept as a future phase per the maintainer's decision. **Do not let these influence P0–P3 design.**

### P4-1 — AI assistance over the open note (Claude) — **L**
- An in-app assistant that reads/edits the active `.md` (summarize, explain, generate practice problems, tidy notes). Design it as an *optional* layer over the file — the note stays plain `.md`, and the app remains fully usable with the feature off.
- **Gate:** requires M0 (safe writes) and a settled save-state machine so AI edits go through the same conflict-safe path as human edits.

### P4-2 — In-editor code execution (Python / C++) — **L**
- Run fenced code blocks and show output inline. Real sandboxing, toolchain detection, and security review required before this is more than a toy.
- **Gate:** significant security surface; do not start without a dedicated design+security pass.

---

## 4. Challenged / cut / de-scoped features

Per the mandate to remove work that doesn't earn its keep:

| Feature | Verdict | Reasoning |
|---|---|---|
| **Automated OCR→LaTeX PDF pipeline (as spec'd)** | **De-scope to a spike (P3-1 Option B)**; ship "PDF as reference" instead | Broken skeleton, ~500 MB model + external binaries, degenerate bounding boxes, accuracy ceiling. Low value-per-effort for one user vs. the manual-reference alternative. |
| **Cloud sync** | **Cut (stays out of scope)** | Violates local-first principle; plain `.md` + Git/Syncthing already covers it. Invest in *making manual sync painless* (P3-4), not building sync. |
| **Mobile / tablet app** | **Cut** | Desktop + stylus is the whole point; a second platform is a different product. |
| **Collaboration / multiplayer** | **Cut** | Single-user tool; enormous complexity for zero personal value. |
| **Segment-level eraser, hold-to-snap shape recognition** | **Defer indefinitely** | Ink is already a daily-usable subsystem; these are diminishing-returns polish. Only revisit if real use demands it. |
| **Distribution: installers, auto-update, code-signing, cross-platform** | **Out of scope now** | Personal tool. Revisit only if the audience decision changes to "ship to students." |
| **Stable note `id` scheme** | **Defer** | `path` is the working key; don't invest until something actually needs stable IDs (e.g. an external integration). |
| **Multi-window / split-pane editing** | **Defer** | Nice, but not blocking daily use; reconsider after M2. |

---

## 5. Cross-cutting concerns (apply across all phases)

- **Testing:** Keep the existing discipline — pure logic (Rust domain fns, TS `lib/`, `ink/`, `store/`) stays unit-tested; the debounce/save-state machine (P0-1/P0-2) **must** get tests since it guards data integrity. Tauri IPC orchestration hooks remain manually QA'd, per existing precedent.
- **Performance budget:** typing latency is sacred — keep DB work off the keystroke path (P0-3). Search and tree refresh should stay sub-100 ms at a few hundred notes.
- **Observability:** add lightweight logging behind the save/index/watch paths (P0) so a future "did it save?" question is answerable. No telemetry — local logs only.
- **Clippy/typecheck gates:** `cargo clippy -- -D warnings`, `npm run typecheck`, `npm run test` stay green on every commit (per `CLAUDE.md`). Note: there is no `npm run lint` script — don't reference one.
- **In-flight work:** the content-derived-title change to `notes.rs` has landed. A separate hazard was found and fixed during P0: `@tiptap/starter-kit` resolved a nested `@tiptap/core@3.29.1` against the pinned `3.27.4`, making every `Editor`/`Node` type nominally distinct and leaving `npm run typecheck` red on 4 errors. `package.json` now pins `@tiptap/core` and `@tiptap/pm` via `overrides` — don't remove them without re-checking typecheck.

---

## 6. Dependency map (critical path)

```
P0-1 debounced autosave ──┬─> P0-2 error surfacing
                          ├─> P0-3 split index write
                          └─> P0-5 external-change refresh ──> P1-3 link-preserving rename
P0-4 atomic writes (parallel)                              └─> P3-3 graph, P3-4 sync
P1-1 create-from-link ──> P1-3 rename ──────────────────────> P3-3 graph
P1-2 quick-switcher ──> P2-2 shortcuts/menu ──> P2-4 onboarding
P3-1 PDF decision (independent) ; P3-2 export (independent)
P4-* gated behind M0
```

**Suggested execution order:** land the in-flight title change → P0-1 → P0-2 → P0-4 → P0-3 → P0-5 → **soak to M0** → P1-1 → P1-2 → P1-5 → P1-3 → P1-4 → **M1** → P2-* → **M2** → P3-1 decision → P3-2 → P3-3 → P3-4 → **M3** → (only then) P4.

---

## 7. Explicitly out of scope

The following are **intentionally not on this roadmap**. Adding any of them is a scope change requiring a fresh decision:

- Cloud sync / accounts / a backend server.
- Mobile or tablet applications.
- Real-time collaboration or sharing.
- Public distribution: signed installers, auto-update, app-store presence, marketing site.
- Cross-platform support beyond the current Windows-primary target (macOS/Linux are a happy accident, not a commitment).
- Plugin system / third-party extension API.
- Encryption-at-rest / DRM (plain `.md` is the point).
- Any feature that makes the `.md` file on disk no longer the plain, portable source of truth.
```
