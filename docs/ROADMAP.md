# null-notes — Product & Technical Roadmap

**Last updated:** 2026-08-13 (**roadmap revision** — see [`specs/roadmap-revision-design.md`](specs/roadmap-revision-design.md). The two weeks since the last update went almost entirely into PDF pipeline refinement, which the roadmap had no boundary for; this revision adds one (§Phase 4, "Pipeline completion criteria"), records the app's actual identity and two closed questions (§1), and **replaces the execution order in §6** — phase numbers are now identity, not order. **Next: ~~finish ruled fractions~~ → ~~freeze the pipeline~~ → triage the three open bugs → P4-3 → the dogfood slice.** Ruled fractions landed and **the pipeline is frozen** as of 2026-08-13 — see §Phase 4, P4-2e.)

*Previously, 2026-07-30: M0–M3 all reached — P2-3 closed M2; P4-1 + P4-2 done — PDF→Markdown converts from the embedded text layer with no OCR, and equations are rebuilt as LaTeX rather than mangled into text; re-scoped against `notes/Plan.md`; Phases 5 "Versioned Workspaces" and 9 "Study & Revision" added — the first features that go beyond the original brief.*
**Audience of this doc:** the maintainer (solo dev).
**Product audience:** you — a personal, offline, daily-driver note app for CS coursework. This is **not** aimed at public distribution yet, which deliberately pushes packaging, cross-platform, auto-update, branding, and onboarding *down* the priority list. Correctness, data integrity, and the editor/ink/PDF workflow come first.

---

## How to read this

- **For the actionable checklist, see [`TODO.md`](../TODO.md).** That file holds the boxes; this one holds the reasoning and the Definitions of Done. If they disagree, this file wins and `TODO.md` gets corrected.
- Phases are **ordered by dependency and value**, not by calendar. As a solo project the useful unit is "what unblocks the next thing," so tasks carry an effort size (**S** ≈ hours, **M** ≈ a day or two, **L** ≈ several days) instead of dates.
- Each phase has a **milestone (Mn)** with a one-line "you can now…" definition. Ship a phase only when its milestone is true.
- Every task has a **Definition of Done (DoD)** — objective and checkable. If the DoD isn't met, the task isn't done.
- **Cut / challenged features** are collected in their own section with reasoning, per the brief's mandate to remove low-value work.
- **Out of scope** at the end is a hard boundary — things intentionally *not* being built, to prevent scope creep.

---

## 1. Product vision

> A Markdown-first, WYSIWYG desktop note app for a CS student who writes math and code daily, sketches diagrams by hand with a stylus, and never wants their notes locked into a proprietary format.

### What it's modelled on (2026-08-13)

The line above describes the app without saying what it is *shaped like*, which left the block editor looking like an implementation detail rather than a pillar. Stated properly:

**null-notes is Notion's editor on Obsidian's storage model**, plus the features this maintainer needs for CS coursework, built partly as a learning exercise. "OneNote" in the original framing meant *handwriting inside notes* — which exists and is done — not a spatial surface.

**Enjoyment and learning are legitimate terms in the prioritization formula.** §3 prioritizes by `daily-use value × friction ÷ effort`, which silently classifies interesting-but-low-ROI work as a mistake. That is not the actual goal function. Naming these makes them budgetable instead of spent undeclared.

#### Closed questions

Recorded so they are not silently reopened.

| Question | Verdict | Date |
|---|---|---|
| Freeform 2D canvas (true OneNote) | **Won't build.** Ink-in-flow is the answer; principle #1 below stands unamended. | 2026-08-13 |
| Does the maintainer currently supply the daily-use signal §3 prioritizes by? | **No** — building, not using. Every priority call below M4 is an estimate. This is the argument for the dogfood slice in §6. | 2026-08-13 |

The canvas verdict connects to Phase 4's completion criteria: a canvas — objects at x/y — has no Markdown representation, which is exactly why principle #1 blocks it. That is the *same problem* the PDF pipeline keeps hitting. Matrices, `\cases`, stacked fractions and multi-column layout are all "2D layout has no linear representation." One problem, two places — so closing the canvas half while leaving the PDF half open would be inconsistent.

**Non-negotiable principles (already honored by the architecture — keep them):**

1. **Plain `.md` is the source of truth.** SQLite is a rebuildable index; deleting it loses nothing. Never invert this.
2. **Offline-first, local-first.** No cloud dependency to open a note.
3. **The file on disk is always safe.** No edit path may silently lose or corrupt a note.
4. **Small, sharp feature set.** Three similar things is not a pattern; don't scaffold half-features.

### The storage boundary

Consistently honored by the code but never written down until now (2026-07-29), which is how invariants get broken by accident. **Where a file lives decides whether it syncs, and that is the entire contract between storage and sync.**

| Inside the workspace folder → **travels with the notes** | In the OS app-data dir → **stays on this machine** |
|---|---|
| `.md` notes — the source of truth | `index.db` (`db/mod.rs`) |
| `NoteName.ink/` sidecars (`ink.rs`) | `settings.json` (`settings.rs`) |
| `NoteName.pdf/` page sidecars (`pdf.rs`) | `recent-workspaces.json` (`workspace.rs`) |
| `NoteName.assets/` pasted images (`assets.rs`) | |
| `.workspace.json` — UI state, gitignored | |

Both sides are load-bearing:

- **`index.db` is outside** because syncing a binary SQLite file produces conflicts nothing can merge — and it is *safe* to exclude only because principle #1 makes it rebuildable. The two rules hold each other up.
- **Settings are outside** so machine-specific preferences don't fight across machines.
- **Ink, PDF and image sidecars are inside** because a note whose drawings or figures didn't travel with it is a broken note. `NoteName.assets/` (P2-3) is the third of the same shape and needed no new argument — which is the point of having written the rule down.

**The rule for new state:** decide which column it belongs in *before* choosing a file format, because that choice determines whether the format must also be a merge format. P5 makes this concrete — anything inside the workspace is now committed and pushed automatically — and P9-3 is the first feature where getting it wrong would be expensive. Anything that is neither note content nor rebuildable from note content needs an explicit decision recorded here.

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

> **Status as of 2026-07-29 — this list is historical.** Risks 1–5, 7 and 8 have been resolved by P0/P1/P2 (see each item's tag below). Risk 6 stands by choice. Kept verbatim rather than deleted because the reasoning is what justifies the save-path rules now codified in `CLAUDE.md`.

1. **Autosave writes on every keystroke with no debounce.** `NoteEditor.onUpdate` → `onChange` → `useNote.save` fires on each edit (`NoteEditor.tsx:30-33`, `useNote.ts:18-25`). Every keystroke = a full file write **plus** a full SQLite reindex of content (FTS), tags, and links (`save_note`, `notes.rs:201-236`). This is a latency and disk-churn problem that will get worse with long notes, and it couples typing latency to DB work. — **✅ fixed, P0-1 + P0-3.**
2. **Save failures are silent.** `save()` awaits `api.notes.save` and discards errors; there is no dirty indicator, no "unsaved"/"save failed" state, no retry. A failed write (disk full, permission, path moved) is invisible → **perceived data loss**. Violates principle #3. — **✅ fixed, P0-2.**
3. **No external-change awareness.** The workspace is scanned only on open. Editing a `.md` in another editor, a `git pull`, or Syncthing landing a change will not refresh the tree, and the FTS index silently goes stale. For a plain-files app this is a correctness gap. — **✅ fixed, P0-5.**
4. **Unresolved wiki-links are dead ends.** Clicking `[[Note That Doesn't Exist]]` does nothing (`WikiLink.tsx:18-20`). The classic "click to create the note" affordance is missing — a real friction point for note-linking workflows. — **✅ fixed, P1-1.**
5. **Wiki-link/backlink resolution is by title string only.** Two notes sharing a title are ambiguous; renaming a note's heading silently breaks inbound links. Acceptable for now, but a known sharp edge. — **⚠️ half fixed, P1-3.** Rename now carries inbound links. Duplicate titles across folders are still ambiguous — unchanged, and still acceptable.
6. **Note `id` is non-stable.** A fresh `Uuid::new_v4()` is minted on every scan/save (`notes.rs:159`, `213`, `257`). `path` is the real key; `id` is effectively decorative. Fine today, but don't build anything on `id`. — **🔵 stands, by choice.** See the de-scope table. Re-examine only if P7 (IDE integration) ends up needing a durable handle for deep links.
7. **App identity is boilerplate.** `productName: "tauri-app"`, `identifier: com.moritz.tauri-app`, default 800×600 window, template README (`tauri.conf.json`, `README.md`). Cosmetic for personal use, but trivially fixable and currently makes the app feel unfinished. — **✅ fixed, P1-5**, except the app icon, which is still Tauri's default (needs an asset, not a code change).
8. **No settings/preferences surface** and **no native app menu** — every capability lives behind an in-app button or a single hardcoded shortcut (`Ctrl+K`). — **✅ fixed, P2-1 + P2-2.**

### Capability gap vs. the original brief (`notes/Plan.md`)

M0–M3 cleared the *reliability* backlog, so the question is no longer "is it safe?" but "is it the app the brief describes?" Auditing `notes/Plan.md` line by line against the code, the answer is: the **editing core is complete**, and three of the brief's pillars were never on this roadmap at all.

| Brief capability | State | Where it lands |
|---|---|---|
| Live preview, `.md`-only, GFM, KaTeX, Mermaid, code highlighting, callouts, tables, task lists, wiki-links/backlinks | ✅ Complete | — |
| **Collapsible sections** | ❌ Missing | P6-1 |
| **Templates** | ❌ Missing | P6-3 |
| Vector ink blocks inline in the note | ✅ Complete | — |
| PDF import **as reference image** | ✅ Complete | P3-1 |
| **PDF import → Markdown** (the brief's flagship: OCR → equations → split into exercises) | ❌ Missing; OCR path cut in P3-1 | **P4** — rebuilt without OCR |
| **Exercise/solution structure + "add next task"** | ❌ Missing | P4-3 |
| **Proof blocks** (Theorem/Proof/Lemma/Corollary/Example) | ❌ Missing | P6-1 |
| **Algorithm blocks** (Complexity/Pseudocode/Implementation/References) | ❌ Missing | P6-2 |
| **Equation snippets** (`/gradient` → `\nabla f(x)`) | ❌ Missing (slash-command infra exists) | P6-4 |
| **Terminal running `claude` against the open note** | ❌ Missing | **P8** |
| **IDE integration**: open project docs, "Open in IDE" on code blocks, `src/main.cpp:58` deep links, per-project `notes/` | ❌ Missing — *entire pillar absent from this roadmap* | **P7** |
| Search over equations + code | ✅ Effectively complete — FTS indexes the raw `.md`, so LaTeX source and code text are already searchable | — |
| Search over PDFs | ❌ Missing — pages are images today | Falls out of P4 for free |
| Search over handwriting | ❌ Missing — needs ink OCR | Cut (see §4) |
| Graphviz, TikZ export | ❌ Missing | Challenged (see §4) |
| Workspace remembers open notes + expanded folders | ✅ Complete | — |
| Workspace remembers split panes, recent searches | ❌ Missing | Deferred (see §4) |

**The re-scope this implies.** Phases 4–9 below are new; the old Phase 4 (AI assistant, code execution) is renumbered into **P10**. **P9 (Study & Revision) is the one phase with no line in this table** — it answers a gap in the brief rather than in the implementation; see §3. Ordering reflects the brief's own emphasis — it calls the PDF/exercise-sheet workflow "a flagship feature" worth "hours every semester," so that goes first, ahead of authoring polish.

---

## 3. Prioritization framework

Given "personal daily driver," priority = **`(daily-use value) × (risk of data loss or friction) ÷ effort`**. Reliability beats new features; new features beat polish; polish beats distribution; distribution is out of scope for now.

| Phase | Theme | Milestone | Status | Why it's here |
|---|---|---|---|---|
| **P0** | Trustworthy daily driver | **M0:** I trust it with my real notes | ✅ | Data-integrity + save-path risks block everything |
| **P1** | Everyday-use completeness | **M1:** I don't reach for another app | ✅ | Small gaps that break flow (links, refresh, quick-switch) |
| **P2** | Feel & ergonomics | **M2:** it's a pleasure to use for hours | ✅ | Compounding daily quality-of-life |
| **P3** | Headline features & power tools | **M3:** the CS-specific superpowers land | ✅ | PDF-as-reference, export, graph |
| **P4** | PDF→Markdown & exercise sheets | **M4:** an exercise sheet becomes a workable note in one step | 2/4 | The brief's own flagship; the biggest single time-saver |
| **P5** | Versioned workspaces (Git automation) | **M5:** my notes commit themselves, in both kinds of repo | | The next tier of P0's data safety — a commit is a recoverable backup |
| **P6** | STEM authoring | **M6:** writing maths/algorithms is faster here than anywhere else | | Compounds on every note; cheap, since the infra exists |
| **P7** | IDE integration | **M7:** notes and code are one workflow, not two | | The brief's second pillar — "integrate, don't replace" |
| **P8** | Embedded terminal | **M8:** `claude` runs against the open note without leaving the app | | Small effort; delivers the brief's AI ask without AI code |
| **P9** | Study & revision | **M9:** the app helps me *revise*, not just capture | | The only phase not derived from the brief — see below |
| **P10** | Gated stretch | **M10:** in-app AI + code execution | gated | Explicitly deferred; do not let it pull focus |

Priority within the new phases follows the same formula (**daily value × friction ÷ effort**), which is why P6 (many small wins on infra that already exists) outranks P7 (a whole new integration surface) despite P7 being the more distinctive feature.

**Why P9 exists (2026-07-29).** Every other phase traces to `notes/Plan.md`. P9 does not, and was added because reviewing the brief exposed a gap in the brief itself: **it is a capture roadmap.** Everything — editing, ink, PDF import, links, graph — helps get material *into* the app. Nothing helps a student get it back *out* at exam time, which is when a study tool either earns its keep or doesn't. It sits at P9 rather than earlier because capture has to be excellent before revision has anything worth revising.

---

## Phase 0 — Trustworthy Daily Driver (P0) ✅

**Milestone M0 reached (2026-07-29):** *I can use this as my only note app for a week without fear of losing or corrupting a note.* P0-1…P0-5 are implemented and their DoDs are met in code and tests — commits `beffda5` (P0-1…P0-4) and `fe22aaa` (P0-5) — and the real-use soak has now happened with **no data-loss incident**. The save path is trusted.

These were all reliability/data-integrity items, and they gated everything else. The rules they established are now codified in `CLAUDE.md`'s "The save path" section — **that section, not this phase, is the living contract**; every later phase that touches a note write is bound by it.

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

**Exit check for M0:** P0-1…P0-5 DoD all met ✅; real-use soak completed with no data-loss incident ✅. The soak did **not** produce a written annoyances list, so P2-3 is seeded from the items already named there rather than from a soak log — see P2-3.

---

## Phase 1 — Everyday-Use Completeness (P1) ✅

**Milestone M1 reached:** *The small gaps that make me switch back to another app are gone.* P1-1…P1-5 all done — links never dead-end (P1-1), recent workspaces plus `Ctrl+P` quick-switching (P1-2), deletes and tab-close were already safe on audit (P1-4), the app has its own identity (P1-5), and renaming a note now carries its inbound `[[links]]` with it (P1-3).

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

### P1-3 — Note rename that preserves links — **M** ✅
Today "title = first heading" and there's no note rename; renaming a heading silently breaks inbound `[[links]]` (risk #5).
- Provide an explicit rename (heading + optionally filename) that rewrites inbound wiki-link targets across the workspace, or records an alias.
- **Dependency:** P1-1 (link machinery), P0-5 (index refresh).
- **DoD:** Renaming a note updates every inbound `[[old]]` to `[[new]]` (or preserves resolution via alias); a backend test covers the cascade, mirroring the existing folder-rename test.

*Done: `rename_note` rewrites the target note's heading (or prepends one if it had none) and walks `backlinks_for(old_title)` — already the exact case-insensitive set that resolves `[[links]]` to this note — rewriting `[[old]]` to `[[new]]` in every one of them and reindexing. Filename is deliberately left untouched (scope is heading-only, per risk #6: `path`, not title, is the real key), so a currently-open backlinking note picks up the rewrite through the existing P0-5 watcher/reload path with no special-casing needed. A pencil button next to each note's delete button in the sidebar prompts for the new title. Six backend tests cover the heading rewrite, the link rewrite, and the end-to-end cascade against an untouched third note.*

### P1-4 — Delete/close UX safety — **S** ✅
- Confirm destructive folder/note deletes (folder delete is a recursive `remove_dir_all`, `notes.rs:376-381`). Confirm closing a tab with unsaved (should be impossible after P0-1, but guard anyway).
- **Dependency:** P0-1.
- **DoD:** Deleting a non-empty folder requires confirmation naming the count of affected notes; no delete path is a single misclick.

*Done: already satisfied by existing code, found true on audit rather than newly built. `TreeNode.tsx`'s note delete and `FolderContextMenu.tsx`'s folder delete (which names the affected note count) both guard with `confirm()`. Closing a tab was already impossible to lose data on: `useNote`'s `useEffect(() => () => void flush(), [path, flush])` flushes any pending write the instant `activeTab` changes away from a note, so a background tab never carries an unflushed edit by the time its tab is closed.*

### P1-5 — App identity cleanup — **S** ✅
Cheap, removes the "unfinished template" feel.
- Set `productName`, `identifier`, window title/size defaults, app icon; rewrite `README.md` to describe null-notes (it's currently the Tauri template readme).
- **Dependency:** none.
- **DoD:** Built app shows "null-notes" everywhere; README documents what the app is, how to run it, and the storage model.

*Done: `productName`/`identifier`/window title are "null-notes" / `dev.nullnotes.app`, default window grew from the template's 800×600 to 1280×800; the Cargo package and lib crate are renamed (`null-notes` / `null_notes_lib`) and `package.json` follows. README rewritten to describe the app, storage model, and run/build commands. App icon left as Tauri's generic default — swapping it needs an actual icon asset, not a code change, so it's deferred rather than silently done.*

**Exit check for M1:** links never dead-end, jumping around is fast, renames don't break references, and the app no longer looks like a template.

---

## Phase 2 — Feel & Ergonomics (P2) ✅

**Milestone M2 reached (2026-07-29):** *Long editing sessions feel good; nothing fights me.* P2-1, P2-2 and P2-4 were already done; P2-3 was the last box and is now cleared. It was no longer DoD-satisfiable as originally written — the M0 soak produced no annoyances list — so it was re-specified against the four concrete items it already named, all four of which shipped.

The visual-design and editor-feel passes are already done (`docs/plans/visual-design-system.md`, `editor-feel.md`). This phase is the remaining ergonomics layer.

### P2-1 — Settings / preferences surface — **M** ✅
- A minimal settings panel: theme (if more than one), editor max-width/typography, autosave debounce interval, default workspace, spellcheck toggle. Persist to a config file (not SQLite — SQLite is a rebuildable index).
- **Dependency:** P0-1 (autosave interval becomes a setting).
- **DoD:** Changing a setting persists across restarts and takes effect without a reload where feasible.

*Done (commits `6c21c5f`, `0b42917`) — this was shipped but never ticked here. `AppSettings` (autosave debounce, editor max width) persists to `settings.json` in the app data dir, deliberately **not** in SQLite (rebuildable index) and **not** in the workspace (app-wide preference, not per-workspace state) — same home as `recent-workspaces.json`. `SettingsPanel` writes through a Zustand store so changes apply live with no reload. Two of the bulleted settings are **not** built: theme (there is only one theme, so the control would be a no-op — deliberately not scaffolded) and the spellcheck toggle, which moves to P2-3 where the rest of the editor-niceties work lives.*

### P2-2 — Keyboard-shortcut layer + native menu — **M** ✅
- A native app menu (File/Edit/View) and a discoverable shortcut sheet. Wire the actions that already exist (new note, new folder, search, toggle raw/WYSIWYG, insert ink).
- **Dependency:** P1-2 (quick-switcher shortcut should be registered here too).
- **DoD:** Every primary action has a keyboard path; a `?`/shortcut overlay lists them; menu items work.

*Done: a native File/Edit/View menu (`build_menu` in `lib.rs`) carries every primary action with its accelerator (New Note, New Folder, New Canvas Note, Open Workspace, Settings in File; clipboard actions in Edit; Search, Quick Switcher, Toggle Source/Preview, Insert Ink Block, Keyboard Shortcuts in View). `on_menu_event` emits one `menu-action` event; `Layout.tsx`'s `runCommand` is the single dispatcher both the menu and (for `?`, which has no natural accelerator) a narrow DOM listener call into — deliberately one source of truth per action so a native accelerator and a DOM keydown handler can't double-fire the same command. `useCreateFolder`/`useCreateCanvasNote` were extracted from Sidebar (mirroring `useCreateNote`) so the sidebar buttons and the menu share logic instead of duplicating it. "Insert ink" reaches the focused note via a plain `command:insert-ink` window event rather than lifting the TipTap editor instance up to `Layout`. `ShortcutsOverlay` lists all nine shortcuts.*

### P2-3 — Editor niceties audit — **S/M** ✅
The M0 soak is done but produced no written annoyances list, so the original DoD ("clear the checklist from the soak") could never be satisfied as written. Rather than leave the task blocked forever on a log that doesn't exist, it was re-specified against the four items it already named — each independently verified as genuinely missing at the time:

- [x] **Spellcheck toggle.** `RawEditor.tsx:12` hardcoded `spellCheck={false}` and the WYSIWYG editor set nothing at all. Wired both to a setting (the one P2-1 deliberately left out).
- [x] **Paste/drop an image into a note.** No paste or drop handler existed anywhere in `src/editor/` — the only `handleDrop` in the codebase was `TreeNode.tsx`'s file-move. Now stores the image beside the note (the `NoteName.ink/` / `NoteName.pdf/` sidecar pattern) and inserts a standard Markdown image.
- [x] **Focus/scroll restoration across tab switches.** Switching tabs and returning dropped you at the top with no cursor.
- [x] **Stable list behavior** on Enter/Tab/Backspace at list boundaries.

- **Dependency:** none (P2-1 for the spellcheck setting's home).
- **DoD (revised):** All four boxes above are ticked, or explicitly struck with a reason. Any *new* annoyance found in ongoing daily use gets appended here rather than opening a fresh task.

*Done. **Spellcheck** is one `AppSettings` field driving both editors, defaulting **off**, which the raw editor had already hardcoded. The field is `#[serde(default)]` because `settings.json` had already shipped without it; a file written by an older build must keep loading rather than dropping the user back to defaults. The toggle goes through `setOptions` because ProseMirror re-applies `editorProps.attributes` on every state update, so setting the DOM attribute directly would be undone on the next keystroke.*

*The first cut was a blanket on/off, and that made the setting close to worthless: turned on, a note is a wall of red under every identifier, `\alpha` and note title. Because the `spellcheck` attribute is **inherited by descendants**, the fix is to mark the non-prose nodes `false` and let them carve themselves out of an editor-wide `true` — code blocks, inline code, inline and block maths, mermaid, tags and wiki-link targets. Callouts deliberately stay in; they hold ordinary prose. Code block and inline code take it through `HTMLAttributes` rather than a `renderHTML` override — same result, no duplicated markup — and are covered by tests asserting the attribute on the real DOM. The five React node views set it on `NodeViewWrapper`, which forwards arbitrary props; those are **not** covered, because a bare `Editor` renders only the `renderHTML` shell and testing a node view needs the full React tree.*

*Two things worth remembering here. The `.settings-row-control input` rule was written for the panel's number inputs, so the new checkbox silently inherited `width: 72px` and a dark background — it rendered as a wide box with no visible tick, which reads as a broken feature rather than a styling bug. And whether squiggles appear at all is a **WebView2/OS capability**, not something this code controls: Chromium on Windows uses the OS spell-checking language pack, and WebView2 does not fetch Hunspell dictionaries the way desktop Chrome does. If a machine shows no squiggles in the raw-Markdown `<textarea>` either, the setting is working and the platform isn't.*

***Images** land in a `NoteName.assets/` sidecar — the third of the same shape, inside the workspace per §1's storage boundary, because a note whose figures didn't travel with it is a broken note. The note itself gets an ordinary `![alt](path)`. Two things only the round-trip tests would have caught: sidecar directories are named after the note and so routinely contain spaces (`Lecture 7.assets/`), and a bare space ends a Markdown link destination — the image silently stopped being an image on the next reload. The attribute now holds the raw filesystem path and encoding happens only at the Markdown boundary; storing the encoded form would need an idempotent encoder and `encodeURI` is not one (it escapes `%`, so every save grew `%20` into `%2520`). `read_note_asset` resolves a path taken from hand-editable note content, so anything but a plain forward-relative path is refused rather than normalised — the §5 "external process / untrusted path" rule applied to file reads.*

***Cursor and scroll** are remembered per note path in a session-scoped module map — the editor unmounts while the next note loads, so neither can live in component state. Deliberately not persisted: where the cursor sat is not note content. The cursor is recorded on `selectionUpdate`, not on unmount, where the editor is already destroyed by the time a cleanup could read it. `focus()` had to be called with `scrollIntoView: false`: it scrolls from inside a `requestAnimationFrame` that lands after the scroll restore and overrode it — when the two disagree, what the user was looking at wins over where the cursor was.*

***Lists** had one real defect, found by writing the boundary cases out as tests: TipTap's `ListKeymap` answers Backspace-at-item-start with `liftListItem` unconditionally, so backspacing at the start of the second item tore the list in half and left a paragraph wedged between the pieces. That case is now claimed ahead of `ListKeymap` and joined into the previous textblock; lifting stays correct for the first item, which `ListKeymap` still handles. The other three behaviours (Enter-exits, Enter-outdents-nested, Tab/Shift-Tab) were already correct and now have tests. Two incidental findings: StarterKit 3 bundles its own `Link`, so the app was registering the name twice and its own `openOnClick`/`autolink` config was the one that lost — now disabled in StarterKit. And the serializer emits a blank line before a nested **task** list but not a nested bullet list; it round-trips to the same structure, so it is left alone and recorded here rather than chased.*

*One methodological note worth keeping: the first version of the list tests mounted the editor without `NoteEditor`'s `editorProps`, so the handlers under test were not installed at all and the tests passed against an editor the app never builds. Any test of key handling has to mount the real configuration.*

**Exit check for M2:** P2-3 cleared ✅. P2-1, P2-2, P2-4 already done ✅. **M2 reached (2026-07-29).**

### P2-4 — Empty/onboarding states — **S** ✅
- The current empty state is one line ("Open a workspace and select a note"). Add a friendly first-run: pick/create a workspace, create your first note, a hint at `Ctrl+K`/`Ctrl+P`.
- **Dependency:** P1-2.
- **DoD:** A brand-new user (or a fresh workspace) has an obvious next action at every step.

*Done: pick/create a workspace was already covered by P1-2's `WorkspacePicker`. A workspace with zero notes now shows an onboarding hint in the sidebar (pointing at New Note / Ctrl N) instead of a blank tree, and the main pane's empty state branches on whether the workspace has any notes — "create your first note" when it doesn't, "jump to one / press ?" when it does.*

---

## Phase 3 — Headline Features & Power Tools (P3) ✅

**Milestone M3 reached:** *The CS-specific superpowers that justify a custom app are real.* P3-1…P3-4 all done: PDF import as a reference image (no broken OCR pipeline), export to PDF via the WebView's print pipeline, a force-directed connections graph, and sync guidance that turned out to already be true by construction.

### P3-1 — PDF import: **decision fork** (do this first in P3) — **decision, then L** ✅ Option A shipped

The current pipeline is a broken skeleton with heavy external dependencies (audit §2). Per the brief's mandate to challenge low-value work, **do not "finish" it by default.** Choose one:

- **Option A — Descope to "PDF as reference" (recommended).** Import a PDF as an attachment and render its pages alongside the note (or into image blocks) so you can transcribe/annotate manually. No OCR, no pix2tex, no tesseract, no 500 MB model, no bundling headache. Delivers ~80% of the daily value (having the sheet next to your solution) for ~20% of the effort, and is fully offline with zero external binaries.
  - **DoD (A):** Drag-drop or "Import PDF" turns the default `pdf-native` feature **on** (or replaces pdfium with a lighter render path), renders pages to images stored beside the note, and inserts them as viewable blocks. No dependency on `tesseract`/pix2tex. Works in a default `cargo build`.
- **Option B — Actually build the OCR→LaTeX pipeline.** Only if automated exercise extraction is a must-have. Requires: real per-word bounding boxes (tesseract TSV output, not `--psm 1` line text — fixes the degenerate-bbox defect at `pdf/ocr.rs:30-38`), reliable region grouping, bundling or first-run-installing tesseract + pix2tex, and the exercise-boundary heuristic from `docs/specs/tech-stack-design.md`. This is an **L+ research effort** with an accuracy ceiling; treat it as a spike with a go/no-go gate, not a committed feature.
  - **DoD (B):** A 20-page typeset sheet imports in <10 s (spec target) into `ExerciseBlock`s with editable extracted text and best-effort LaTeX, on a machine set up by a documented one-command installer; failure modes degrade to plain text, never crash.

**Recommendation:** Ship **Option A** now; keep **Option B** as an optional spike behind a feature flag. Don't block M3 on B.

*Done (Option A): `pdf-native` is now a default feature — `pdfium-render` is a pure-Rust binding crate with no native-binary requirement at compile time, so a default `cargo build` still succeeds; only an actual import at runtime needs the pdfium library present, and that fails with a clean error rather than a crash if it's missing. `ocr.rs`, `equations.rs`, `parser.rs`, and the dead `ExerciseBlock` node (no markdown serialize, never actually inserted by the old pipeline) are deleted rather than kept as a "spike behind a flag" — the audit already established the OCR code was broken (degenerate bounding boxes) and unsalvageable without a rewrite, so there was nothing worth preserving. Pages render straight into a `NoteName.pdf/` sidecar directory next to the note (mirroring `NoteName.ink/`) instead of the old code's leaked temp directory — fixes a real unbounded-disk-growth bug as a side effect. A new `PdfPageBlock` node (mirroring `InkBlock`'s markdown fenced-block pattern) displays each page as an image, loaded via a `read_pdf_page` → base64 IPC call rather than the Tauri asset protocol, keeping the same "binary data over IPC" shape `read_ink` already established rather than introducing a new capability/permission surface.*

### P3-2 — Export (print / PDF / HTML) — **M** ✅ PDF via print
High daily value for a student (submitting or sharing notes) and currently absent.
- Export the active note (and its rendered ink/math/mermaid) to PDF and/or standalone HTML. Leverage the WebView's print pipeline where possible.
- **Dependency:** none (but nicer after P2 typography settings).
- **DoD:** A note with math, a code block, a Mermaid diagram, and an ink block exports to a PDF that visually matches the editor.

*Done (PDF path): File > Export to PDF calls the WebView's own `window.print()` — since math (KaTeX), Mermaid (already configured with `theme: 'default'`, print-safe out of the box), code highlighting, and ink (rendered SVG) are all live DOM content by the time export runs, printing captures them exactly as shown with zero custom rendering code. The only real work was a `@media print` block: it redefines the dark-theme CSS custom properties to a light, print-safe palette (including per-callout-type light backgrounds, since those use their own hardcoded dark colors rather than the shared tokens), hides app chrome (sidebar, tab bar, toolbars, status bar, backlinks panel), and adds page-break-avoidance around headings/code/tables/ink/PDF-page blocks. If the raw-markdown view is active, export switches to the rendered view first — printing raw text wouldn't match the editor. Standalone HTML export (the "and/or" half of the DoD) is not done — PDF alone satisfies the DoD's visual-fidelity requirement, and bundling a truly standalone HTML file (inlined KaTeX/highlight.js CSS) is a separate, harder problem not worth scope-creeping into this pass. Visual output wasn't independently re-verified beyond CSS review — worth a manual check against a note with all four content types before fully trusting it.*

### P3-3 — Knowledge graph / connections view — **M/L** ✅
The data already exists (`note_links`, backlinks). A local graph of notes↔links↔tags is a natural, high-value power feature for revision.
- **Dependency:** P1-1/P1-3 (link integrity), P0-5 (fresh index).
- **DoD:** A view renders notes as nodes and `[[links]]`/shared tags as edges; clicking a node opens the note; it stays responsive at a few hundred notes.

*Done: `graph_links`/`graph_tags` hand over every link/tag row in the workspace at once (new, alongside the existing per-title/per-tag `backlinks_for`/`notes_with_tag`); `buildGraph` (pure, tested) resolves them into deduplicated nodes/edges — link resolution matches how `[[links]]` resolve everywhere else (case-insensitive title match, unresolved links dropped rather than shown as dangling nodes), notes sharing a tag get a pairwise edge. Layout uses `d3-force`, run to convergence synchronously via manual `.tick()` calls rather than an animated `.on('tick')` loop, so the graph renders once, fully settled — no per-frame re-renders regardless of note count. `View > Connections Graph` (`Ctrl+G`) opens it; clicking a node opens the note. Viewbox auto-fits to the settled layout's bounding box so the graph is never clipped at any size.*

### P3-4 — Manual sync guidance, done well — **S** ✅
Sync is out of scope as a *feature* (principle #2), but since files are plain `.md`, make Git/Syncthing painless.
- A sensible `.gitignore` (index.db, tmp, ink temp), docs on the recommended sync setup, and — after P0-5 — graceful handling of files appearing/changing from a sync client.
- **Dependency:** P0-5.
- **DoD:** A documented Git-based sync round-trip (edit on machine A, pull on machine B) works without index corruption or manual re-scan.

*Done: mostly already true by construction, this was a documentation + verification pass rather than new code. `index.db` was never inside the workspace to begin with (it lives in the OS app-data dir — the README's "sits alongside the workspace folder" was actually wrong, fixed while here), so there's nothing workspace-side to gitignore for it. Traced the actual round-trip: `watch_workspace`'s debounce already batches a burst of changes (exactly what a `git pull` touching many files produces) into one `workspace-changed` event; `useExternalChanges` reindexes every changed path in parallel and refreshes the tree once, and `reindex_from_disk`'s existing not-found fallback (`forget_note`) already handles a file a pull deleted. README documents the setup and a minimal workspace `.gitignore` (`.workspace.json` — UI state, not content — and stray crash-temp files). Not literally tested across two physical machines; verified by tracing the code path rather than an end-to-end run.*

---

## Phase 4 — PDF → Markdown & the Exercise-Sheet Workflow (P4) — P4-1, P4-2 and P4-2e done; the pipeline is frozen, P4-3 closes M4

**Milestone M4:** *I can drop an exercise sheet into the app and immediately start writing solutions into it — as text I can edit, not a picture.*

P3-1 shipped **PDF as reference image** and cut the OCR pipeline. That decision stands and is not being reopened — but it only delivered half the brief. The app needs **both import modes**, the way Notion does: keep the page as an image *or* convert it to editable Markdown, chosen at import time.

**The key insight that makes this cheap: exercise sheets don't need OCR.** They are LaTeX/Word-typeset PDFs that carry a real embedded text layer. `pdfium-render` 0.9 — already a default dependency since P3-1 — exposes `page.text()` → `PdfPageText` with `.chars()`, per-character loose bounding boxes, `chars_for_object()`, and `inside_rect()`, plus font name and size per text object. That is exact glyph geometry, for free, offline, with no `tesseract`, no pix2tex, no 500 MB model, and no new dependency. Structure reconstruction becomes deterministic geometry, not machine learning.

This is why P3-1's audit conclusion ("OCR is unsalvageable") and this phase are not in conflict: **the old pipeline was rasterising a PDF and then trying to read the pixels back, throwing away a text layer that was sitting right there.**

### P4-1 — Import mode picker + text-layer extraction — **L** ✅
- At import, ask: **Pages** (current P3-1 behaviour) or **Markdown**. Remember the last choice.
- Extract the text layer and reconstruct structure from geometry:
  - **Lines** — group chars by baseline y; **blocks** — group lines by vertical gap relative to median line height.
  - **Headings** — font size significantly above the body-text median.
  - **Code blocks** — runs in a monospace font family.
  - **Lists** — leading bullet/number glyph plus a consistent indent.
  - **Emphasis** — bold/italic font variants → `**`/`*`.
- **Dependency:** P3-1 (rendering, sidecar directory, IPC shape).
- **DoD:** A typeset exercise sheet imports into a `.md` note whose headings, paragraphs, lists and code blocks match the source's visual structure; the note is a normal editable note (not a viewer), and its text is returned by `Ctrl+K` search immediately — which also closes the brief's "search should include PDFs" gap for free. No `tesseract`/pix2tex dependency; works in a default `cargo build`.

*Done. The import dialog asks Pages or Markdown per import and remembers the answer in `settings.json` (app-wide machine-local preference, same home as the autosave delay). The converted note is created through the ordinary `create_note`/`save_note`/`reindex_note` path, so it is editable and `Ctrl+K`-searchable with no special casing — the brief's "search should include PDFs" gap closes as a side effect, exactly as predicted.*

***The structural decision: `pdf/layout.rs` takes plain `CharBox` values, not pdfium types.*** *That is what makes the algorithm testable at all — the test machine has no pdfium, and the two pre-existing render tests are `#[ignore]`d for exactly that reason. Keeping the judgement in a pdfium-free module bought 22 real tests driven through a small typesetter that lays glyphs out the way a PDF does; `pdf/extract.rs` is the thin translation layer and carries no decisions.*

*The pdfium API turned out **better than this phase assumed**: `font_is_fixed_pitch()` gives code-block detection with no font-name list, and `font_weight()`/`font_is_italic()` give emphasis directly. Font-name matching is only still needed for P4-2's maths detection.*

*Three things the tests forced, each a real bug rather than a tuning preference:*
- *Baseline tolerance scales by the **larger** of the two font sizes. A superscript sorts above the line it belongs to, so anchoring to the row's first character let it set the tolerance from its own tiny size and reject its own line.*
- *The line-gap median is the **lower** one. Line gaps outnumber paragraph gaps, so with only a couple of gaps to judge from, rounding toward the smaller is what keeps a paragraph break detectable.*
- *Emphasis padding sits **outside** the markers — `**word ** after` is not emphasis in Markdown.*

*Also: `loose_bounds()` rather than `tight_bounds()`, because tight bounds cover a glyph's inked extent and a comma would then leave a gap wide enough to fake a space after every one. Conversion runs in `spawn_blocking` (pdfium is synchronous) and **before** the note is created, so a failed conversion leaves no empty note behind.*

*Scanned-PDF detection landed here rather than in P4-2 because it was five lines and P4-1 must not produce a garbage note. The other half — actually offering Pages mode rather than only naming it — shipped with P4-2.*

*Not verified against a real PDF — pdfium is not present on this machine, so the whole pdfium-facing path (`extract_pages_native`) is compile-checked only. The geometry it feeds is thoroughly tested; the translation into it is not.*

### P4-2 — Honest degradation: maths regions and scanned PDFs — **M** ✅
The two ways P4-1 can produce garbage. Both must fail visibly, never silently.
- **Maths.** LaTeX-rendered equations have no LaTeX in the PDF — they are glyph runs in maths fonts (CMMI/CMSY/MSAM/STIX). Extracting them as text yields mangled nonsense. Detect maths-font runs and **rebuild LaTeX from the glyph geometry and the face each glyph came from**, rather than emitting flat text.
- **Scanned PDFs.** A near-empty text layer means there is nothing to convert. Detect it up front, say so plainly, and offer Pages mode instead of producing an empty or garbled note.
- **Dependency:** P4-1.
- **DoD:** A sheet with display and inline maths imports with every equation as valid, copyable LaTeX (`$…$` / `$$…$$`), not as corrupted text. A scanned PDF is detected before conversion and routed to Pages mode with an explanatory message — it never produces a garbage note.

*Done in two passes — the first shipped, the second replaced it, and both are worth keeping on the record because the reason for the reversal is a real design lesson.*

***Pass one cropped the region as an image**, verified by rendering the crops and looking at them: `f : ℝ² → ℝ`, `f(x, y) = √(x² + y²)`, `(x₀, y₀) = (3, 4)` all visually exact. It stood as the shipped answer for about a day. **The user then named the actual use case — pasting a converted sheet into an LLM prompt — and an image cannot be copied into a prompt, searched, or edited, and it never went through the editor's own KaTeX pipeline that P2-3's InlineMath/BlockMath nodes already provide.** That is a materially different requirement than "looks right," and crops fail it categorically, not partially. Rebuilt as LaTeX instead.*

***What makes LaTeX recoverable at all: which face a glyph came from carries most of its meaning.** Computer Modern splits mathematics by role, not by look — `CMMI` variables, `CMSY` relations, `CMEX` extensible glyphs, `MSBM` blackboard bold, `RSFS`/`EUFRAK` script and fraktur. `pdf/maths.rs` classifies the face; `pdf/latex.rs` turns face plus geometry (smaller and off-baseline → a script; consecutive upright letters → an operator name) into LaTeX. Pure and pdfium-free, so it is unit-tested the same way `layout.rs` is.*

*Four bugs the real document forced, each invisible in a synthetic fixture:*
- ***A radical is set on its own baseline above its radicand.*** *`√(x²+y²)` arrived as two separate lines and rendered `\sqrt{}` next to a stray expression. A row made only of extensible glyphs now folds into the row beneath it before line-building runs.*
- ***The subscript offset threshold was sized for exponents.*** *TeX drops a subscript far less than it raises a superscript — 1.8pt vs 4.4pt on a 12pt line — so every subscript was silently absorbed into the base expression: `T_3` read as `T3`.*
- ***A maths region is a direct slice of the page's character row, bypassing `layout.rs`'s own gap-based space synthesis.*** *`= √(...)` lost its space and became `=\sqrt{...}`. Redone locally in `latex.rs` against the same `SPACE_GAP` constant.*
- ***A footnote marker is a raised, reduced-size digit glued onto the period after an equation — geometrically identical to a real exponent except for what it follows.*** *An exponent never sits directly after terminal punctuation, so region growth now stops right after including `.`/`,`/`;`/`:`/`!`/`?` if what follows is itself a script. `T_2(...).3` no longer reads `T_2(...).^3`, and ordinary mid-expression commas and digits are untouched.*

*Also: a radical's trailing sentence punctuation is trimmed out of `\sqrt{}` — the vinculum is a drawn rule, not a character, so where the radicand ends is already a guess (`RADICAL_TAKES_REST`), and swallowing the sentence's own full stop was an avoidable part of that guess.*

*Scanned detection **offers** Pages mode rather than only naming it — the button was the missing half flagged in P4-1.*

***Known and deliberately out of scope:** multi-line vector/matrix notation — a gradient dotted into a stacked column, a Hessian — has no single-baseline representation at all and comes out as glyph-order text, not valid LaTeX. This is a structurally different problem (2D layout, drawn brackets) rather than a tuning gap in the current approach. `throwOnError: false` on both maths nodes means a bad equation renders KaTeX's own inline error rather than breaking the note or anything around it, so the failure is contained — but it is a real gap, not a hidden one.*

***Hyphenation, fixed after all.** The paragraph below was written the same day the limitation was found and stood as the record for about as long as it took to get real evidence: pdfium reports a discretionary hyphen as `U+0002` with its own `is_hyphen()` flag set, and it was being discarded by the synthetic-character filter as an ordinary control character. It is the only record that a wrapped word's two halves are one word — the geometry alone says nothing. Kept as a soft hyphen through extraction; reflowing a paragraph now closes the halves and trims the trailing space the broken line carries at the line end, where it means nothing. `Entwicklungsstelle` reads correctly. The stream-adjacency attempt described below really was reverted as described; this was a different, correct signal found afterward.*

***A second real document (a complex-analysis sheet) surfaced two bugs worse than anything above, both now fixed, verified by converting it and diffing the output against a hand-written reference note:***
- ***Every word of German prose was silently missing from the converted note.*** *The extraction filter's signal for pdfium's synthetic layout characters was an empty `font_name()`. That held for the first document this pipeline was tested against, but is producer-dependent: this PDF's real body-text font also reports an empty name through pdfium, for reasons that have nothing to do with being synthetic filler. Re-keyed on font size instead — pdfium's actual filler is consistently ~1.0pt in both documents seen, and no real glyph, not even a subscript, is ever set that small.*
- ***Ordinary prose was getting torn apart mid-word with no maths or line break anywhere near it*** *(`wird jeweils` → `wirdj eweils`). A generated space's own `x` coordinate landed **inside** the following letter's advance box — sorting a row by raw `x`, which every fix up to this point had assumed was reliable, is exactly wrong when one character's own geometry lies. A row is now ordered by each character's position in the page's own extraction stream instead, which pdfium never gets wrong regardless of what an individual glyph's coordinate says. `x` is unchanged for everything else — gaps, script detection, region bounds.*

*Four smaller gaps that document also exposed, diagnosed but not attempted — detail and reasoning in `TODO.md`'s P4-2b: **fractions** (same root cause as the matrix/vector limitation — a numerator and denominator are separate physical lines with the bar drawn as an invisible-to-text-layer graphics path — but far more disruptive in a fraction-heavy sheet), **`∮`** (pdfium hands back an ASCII placeholder instead of a real Unicode value; a blind family-scoped guess was deliberately not added, since CMEX overloads ASCII codepoints per sub-font and a wrong guess would silently corrupt some other symbol elsewhere), **an enumeration-label boundary artifact** (`(a$) C$`), and **`ß` decoding to `ÿ`**, confirmed to be pdfium's own decoding of this specific font and not fixable from here.*

### P4-2e — Pipeline completion criteria (2026-08-13) — **S**, docs only ✅ **the pipeline is frozen**

**This subsystem is the only one on the roadmap with no natural end.** There is always another real document with another 2D-layout bug, and the two weeks after P4-2 was declared done proved it: ~120 commits, none of them wrong individually, none of them bounded collectively. A boundary has to be written as a rule, because "P4-2 is done" plainly was not one.

**Ruled fractions was the last 2D shape.** The freeze takes effect on its completion — a rule with a carve-out for work already underway is still a real rule, provided the carve-out is named and finite, and abandoning a half-built feature costs more than finishing it. It landed across `c72a24e`…`851bfff` (Blatt11 5 → 10 fractions, Blatt10 2 → 3, no sheet's count reduced; results and the constants that shipped are in `specs/pdf-ruled-fraction-reconstruction-design.md` §Implementation notes), **so the freeze is now in force:**

- **The corpus is frozen** at the documents already in it. It is the regression suite. Adding a document is a deliberate decision, not a reflex.
- **The bar is M4's own DoD — "faster than transcribing by hand" — not "correct."** A converted sheet needing three manual fixes still saved forty minutes. Correctness past that bar is not what this feature is for.
- **A new bug earns work only if it is whole-document** (prose loss, mid-word tearing — the P4-2b class, where output is silently wrong rather than visibly incomplete) **or recurs across two or more corpus documents.** Single-document, single-instance cosmetic bugs are recorded in `TODO.md` and left. *This is the load-bearing rule — the one that would have ended most of the last fortnight, and the one that will feel wrong to apply in the moment.*
- **2D-layout reconstruction is closed.** Matrices, `\cases`, stacked fractions, operator limits, tables and ruled fractions are the complete set. No new shapes. Anything outside it renders as glyph-order text, and `throwOnError: false` on both maths nodes contains the failure to that one equation.
- **Re-entry condition:** the pipeline reopens when *real coursework use* produces a document that fails the by-hand bar. Not before, and not from a diagnostic sweep.

- **DoD:** the rules above are recorded here and in `TODO.md`; the next 2D shape encountered is filed rather than fixed. ✅ — `TODO.md`'s P4-2e now carries a **"Filed, not fixed"** list, which is where a post-freeze bug goes instead of into a commit. An empty list is the feature working, not a gap.

### P4-3 — Exercise splitting, solution scaffold, and "add next task" — **M**
The part the brief says "would save students hours every semester."
- Split the converted sheet on an exercise-heading pattern (`Aufgabe 3`, `Task 3`, `Exercise 3`, `Problem 3`, `3.`) into `## Task N` sections, each followed by a `### Solution` block.
- **"Add next task"** — a command/button that appends the next correctly-numbered Task/Solution pair, so space per task is never something to plan in advance (the brief's explicit ask).
- **Dependency:** P4-1. Independent of P4-2.
- **DoD:** A sheet with 5 exercises converts to 5 `## Task N` + `### Solution` pairs; "add next task" appends a correctly-numbered sixth. Where the heading pattern doesn't match, the note converts as one unsplit document — a miss degrades to plain conversion, never to dropped content.

**Exit check for M4:** both import modes work and are chosen at import; a real exercise sheet from a real course converts into a note that is genuinely faster to work in than transcribing by hand.

---

## Phase 5 — Versioned Workspaces / Git Automation (P5)

**Milestone M5:** *My notes commit themselves. A paragraph I deleted yesterday is recoverable, and I never think about it.*

**This is not the cloud sync that was cut.** That cut was about the app building accounts, a server, and a sync protocol — it stands. This is P3-4's mandate ("make Git painless") taken from documentation to automation: the app drives the user's own Git, with the user's own remote. Local-first is untouched; nothing here is required to open a note.

**Why it sits right after P4:** it is the next tier of P0's work. P0 guaranteed the file on disk is never corrupt. This guarantees *yesterday's version still exists*. A commit is a recoverable backup, which makes this a data-safety feature that happens to look like convenience.

### The two modes, and why they get different defaults

Everything in this phase follows from one distinction:

| | **Notes-only workspace** (lecture notes) | **Notes inside a code repo** (`notes/`, `docs/`) |
|---|---|---|
| Whose history is it? | Yours alone | Shared; other people read the log |
| Commit noise | Harmless | A real cost |
| Auto-push | Yes | **Never** |
| Risk of touching unrelated work | None | High — your source lives there |

The code-repo case is the dangerous one, and the guardrails below exist because of it.

### P5-1 — Repo detection + per-workspace Git config — **S/M**
- On opening a workspace, detect whether it is inside a Git repo and which mode applies: repo root ≈ workspace (**notes-only**) vs. workspace is a subtree of a repo containing source (**code repo**).
- **Shell out to `git`, don't link `git2`/`gix`.** Shelling out inherits the user's credential helpers, SSH agent, commit signing and `.gitconfig` for free — all of which are painful to reimplement and impossible to get exactly right. Requires `git` on `PATH`, a safe assumption for this audience.
- Config is **per-workspace and machine-local** (autocommit on/off, cadence, push policy). "Should this machine autocommit" is a fact about the machine, not about the notes, so it belongs beside `.workspace.json` — which P3-4 already gitignores — not in a synced file.
- **Opt-in.** Detecting a repo prompts once; it never starts committing on its own.
- **DoD:** Both modes are correctly identified on open; no Git command runs against any workspace that hasn't been explicitly opted in.

### P5-2 — Batched auto-commit — **M**
The core of the phase, and where every safety property lives.
- **Coarse cadence:** one commit per editing session, or after N minutes idle — deliberately far coarser than the 600 ms save debounce and the 2.5 s reindex debounce. Never per-save. Message summarizes what changed (`notes: update Analysis II Lecture 7, Lecture 8`).
- **Always pathspec-scoped.** `git add -- <note paths>` and `git commit -- <paths>`. Never `git add -A`; never a bare `git commit`, which would sweep in whatever the user has staged. In a code repo this is the difference between a useful feature and one that silently commits half-finished source.
- **Back off, never repair.** Skip the commit entirely if the repo is mid-rebase/merge/cherry-pick, on a detached HEAD, or already carries conflict markers. Report it quietly in the status bar. The app must never attempt to fix a repo state it didn't create.
- **Hooks: run them, and abort on failure.** A note commit in a code repo will trigger that project's `pre-commit`. Silently passing `--no-verify` in someone's repo is exactly the kind of decision that shouldn't be made on their behalf, so the default is to run hooks and abandon the auto-commit if one fails, surfacing why. A per-workspace "skip hooks for note commits" toggle exists for the case where the user knows their hooks don't cover `notes/` — opt-in, never assumed.
- **Dependency:** P5-1.
- **DoD:** An editing session produces exactly one commit touching only note paths. **Critically:** in a repo with staged source changes and unstaged source edits, both are still exactly as they were after an auto-commit runs — covered by a test, because this is the property whose violation would be unforgivable.

### P5-3 — Push policy — **S**
- **Notes-only workspace:** push after commit (configurable, on by default).
- **Code repo: never auto-push, at any setting.** Notes ride along with your next real push. Auto-pushing into a shared repo can trigger CI and put commits on a branch someone else is working from — outward-facing, hard to undo, and not worth the convenience.
- Handle no-remote, auth failure, and non-fast-forward rejection by surfacing the error; never retry blindly, never force.
- **Dependency:** P5-2.
- **DoD:** No sequence of UI actions causes a push from a code-repo workspace. A notes-only workspace pushes after commit and reports failures visibly rather than silently falling behind.

### P5-4 — Fast-forward-only auto-pull — **M**
The laptop→desktop case, and **the most dangerous task on the roadmap** — a bad merge writes `<<<<<<< HEAD` into a `.md`, which the editor will faithfully render as content.
- On workspace open (and optionally on an interval): fetch, then compare.
- **Local has no divergent commits → fast-forward silently.** The resulting burst of file changes is already handled: P0-5's watcher debounces it and P3-4 traced exactly this path for `git pull`.
- **Histories have diverged → stop.** Show a bar reusing the P0-5 conflict-bar pattern ("remote is ahead by 3, you're ahead by 1") and let the user resolve it in the terminal (P8) or their Git tool.
- **Never auto-merge, never auto-rebase, never write a conflict marker into a note.**
- A dirty buffer is never overwritten by a pull — this extends `CLAUDE.md`'s existing "a dirty buffer is never overwritten from disk" rule to cover the pull path, which is new.
- **Dependency:** P5-1. Independent of P5-2/P5-3.
- **DoD:** A laptop→desktop round trip fast-forwards with no prompt and no conflict. A deliberately diverged history produces a prompt and **zero** conflict markers in any `.md`. A dirty buffer survives a pull that would have changed its file.

### P5-5 — Repo creation for a notes-only workspace — **S**
- A workspace that isn't a repo offers: `git init`, the `.gitignore` P3-4 already documents, and optionally a GitHub remote via `gh repo create`.
- **Private by default** — lecture notes must not become public by accident.
- If `gh` is absent, initialize locally and print the exact remote command to run. Never a hard dependency on `gh`.
- **DoD:** A plain notes folder becomes a private GitHub-backed repo in one action, or degrades to a working local repo with clear next steps when `gh` isn't installed.

**Exit check for M5:** notes commit themselves in both modes; a code repo's staged work, unstaged work, branch and history are provably untouched outside note paths; a laptop→desktop round trip completes without a single conflict marker.

---

## Phase 6 — STEM Authoring (P6)

**Milestone M6:** *Writing maths, proofs and algorithms is faster in this app than in any general note app.*

Cheap phase with a high hit rate: the callout node, the slash-command menu, and the markdown-serialisation pattern all already exist, so most of these are configuration and a serializer rather than new subsystems. **Every new node must carry its own `addStorage().markdown.serialize/parse`** — per `CLAUDE.md`, a node without one silently serialises as escaped plain text, which is data loss in slow motion.

### P6-1 — Proof blocks + collapsible sections — **M**
- Theorem / Lemma / Corollary / Proof / Definition / Example blocks with optional numbering and a title.
- Collapsible sections (`<details>`-equivalent) — a brief item never built, and the natural way to hide a long proof.
- Build both on the existing `Callout` node's pattern rather than inventing a second block mechanism.
- **DoD:** Each block type inserts from `/`, round-trips through save→reload with its type and title intact, and prints correctly in the P3-2 PDF export. Collapse state is presentation-only — it never changes the `.md` content.

### P6-2 — Algorithm blocks — **M**
- A block with Complexity / Pseudocode / Implementation / References slots, per the brief.
- **Dependency:** P6-1 (same node pattern; build it second and reuse the machinery).
- **DoD:** Round-trips to readable Markdown that still makes sense opened in any other editor — the plain-`.md` principle applies here more than anywhere, since this is the most structured node in the app.

### P6-3 — Templates — **S/M**
- A `templates/` folder in the workspace; "New from template" in the sidebar and File menu. Minimal placeholder substitution (date, title) and nothing more.
- The exercise-sheet layout from P4-3 becomes the first real template.
- **DoD:** Creating a note from a template produces the template's content with placeholders filled; templates are plain `.md` files, editable as normal notes.

### P6-4 — Equation snippets — **S**
- `/gradient` → `\nabla f(x)`, and a table of the common ones. The `SlashCommands` extension already provides the menu, so this is a data table plus a maths-mode filter.
- **DoD:** Typing `/` inside a maths context offers snippets and inserts valid KaTeX; the list is one editable table, not code scattered per snippet.

### P6-6 — Outline / table-of-contents panel — **S**
Long lecture notes are hard to move around in, and P6 is the phase that makes notes longer and more structured.
- Headings of the current note in the right rail, click to jump; highlight the heading currently in view.
- Share the rail with `BacklinksPanel` rather than adding a third permanent column.
- **Dependency:** none — the heading data is already in the ProseMirror document, so this needs no backend work at all.
- **DoD:** A long note's headings are listed and clickable; the list tracks the current scroll position; toggling the panel is on the P2-2 shortcut layer.

*Placement note: this was proposed alongside the P9 study features, but it is an **S**-effort navigation aid that serves any long note — parking it behind three phases would waste it. Moved here deliberately.*

### P6-5 — Search refinement — **S**
The brief asks search to cover "equations, code, handwritten notes, PDFs." Equations and code already work (FTS indexes the raw `.md`); PDFs arrive with P4-1; handwriting is cut (§4). What's actually missing is **scoping**.
- Filter results by folder and by tag; keep a short recent-searches list (a brief workspace-memory item).
- **DoD:** Search can be narrowed to a folder or tag without leaving the keyboard; recent searches persist per workspace.

---

## Phase 7 — IDE Integration (P7)

**Milestone M7:** *Notes and code are one workflow. I never manually hunt for the file a note is talking about.*

The brief's second pillar — **"IDE integration instead of IDE replacement"** — and the thing that most distinguishes this from Obsidian. It was entirely absent from this roadmap before 2026-07-29. It sits after P4/P6 because it opens a genuinely new surface (launching external processes) rather than building on existing infra.

**Design constraint:** the note stays plain `.md`. A deep link is ordinary Markdown that degrades to readable text in any other editor — never a proprietary token.

### P7-1 — Code deep links — **M**
- Recognise `src/main.cpp:58` (and `path/file.rs#L20-L30`) in note text and make it clickable; clicking opens the configured editor at that file and line.
- Resolve paths relative to the workspace root, or to a project root if the workspace is inside one.
- **Security:** this executes an external process using text taken from a note. The launcher must pass the path as an argument to a configured command, never through a shell, and must refuse paths that escape the workspace/project root. Do not build the naive version.
- **DoD:** Clicking a `file:line` reference opens the right file at the right line in the configured editor; an unresolvable path renders as inert text with a clear "not found" affordance, exactly like an unresolved wiki-link; a path containing shell metacharacters cannot cause command execution, and a test covers that.

### P7-2 — "Open in IDE" on code blocks — **S**
- A code block that carries a source path gets an "Open in IDE" action.
- **Dependency:** P7-1 (same launcher, same path resolution, same guardrails).
- **DoD:** The action appears only on blocks that actually have a resolvable path — never a dead button.

### P7-3 — Project awareness & project notes — **S/M** *(smaller than it looks — see the scan note)*
- **Scan ignore list — S. Do this first; it is the whole unlock.** A workspace is just a folder scanned for `.md`, so opening a code repo as a workspace *already works* — except `is_excluded_dir` (`src-tauri/src/commands/notes.rs:113`) skips only `.ink` and dot-directories, so the scan walks `node_modules/` and `src-tauri/target/` and drowns. Exclude the standard build/dependency directories (`node_modules`, `target`, `dist`, `build`; `.git` is already covered by the dot rule).
- Open a code project as a workspace and surface its existing `README.md` / `docs/` / `notes/` directly, with no import step (the brief: "No importing").
- Optionally scaffold a `notes/` folder (Architecture / Meeting / Research / Todo) on request — **on request only**, never automatically, and never writing into source folders.
- **DoD:** Pointing the app at this repo lists the files in `docs/` and nothing from `node_modules/` or `target/`, and does so as fast as a notes-only workspace; scaffolding is opt-in and creates only inside `notes/`.

*Why this moved up (2026-08-13): it is the cheapest path to the maintainer becoming a **user** of the app, which §1's second closed question identifies as the missing input to the whole prioritization formula. This project's own `docs/` — 18 specs, a plans folder, this roadmap — is a real daily Markdown workflow currently being done in another editor. See §6.*

### P7-4 — Editor command setting — **S**
- A configurable launch command template (VS Code, JetBrains, Neovim…) in the P2-1 settings panel, with sensible detection of what's installed.
- **Dependency:** P2-1. Land this **with** P7-1 — a hardcoded editor path would be an immediate rewrite.
- **DoD:** Switching the configured editor changes where deep links open, with no code change.

---

## Phase 8 — Embedded Terminal (P8)

**Milestone M8:** *I can run `claude` (or any CLI) against the note I'm looking at without leaving the app.*

The brief's actual AI ask is *"a terminal in which I can do `claude` and work with the opened `.md` file"* — which is a **terminal feature, not an AI feature**. It is roughly an order of magnitude cheaper than the in-app assistant (P10-1), ships no AI code, adds no API key handling, and works with any CLI tool. Crucially, **the hard part is already built**: P0-5's watcher means a file edited by an external process is already detected, reloaded when clean, and conflict-prompted when dirty. The terminal is a client of infrastructure that exists.

### P8-1 — Terminal pane — **M/L**
- A terminal pane (PTY-backed) rooted at the workspace, with the active note's path readily available — an env var and a one-key insert.
- **Dependency:** P0-5 (external-change handling is what makes CLI edits safe). Benefits from P2-2's command dispatcher for the toggle shortcut.
- **DoD:** Running `claude` in the pane and having it edit the open note updates the editor through the existing watcher path, with no new reload logic and no conflict-handling special case. Closing the pane leaves no orphaned process.

---

## Phase 9 — Study & Revision (P9)

**Milestone M9:** *At exam time the app is where I revise, not just where my notes happen to live.*

The one phase not derived from `notes/Plan.md`. Everything before it is capture; this is retrieval. Ordered cheapest-first, because P9-1 is small enough to ship in a sitting and P9-3 needs a decision made before any code.

**Architectural rule for this whole phase:** study state is **data**, not index. Principle #1 says deleting `index.db` loses nothing — so nothing here may keep its only copy in SQLite. The established pattern applies exactly: source of truth in the `.md`, a derived table in `index.db` rebuilt by the same reindex path that already carries `note_tags` and `note_links`.

### P9-1 — Workspace-wide task view — **S/M**
Coursework tasks live scattered across notes (`- [ ] finish exercise 3`) with no way to see them together.
- Extract `- [ ]` / `- [x]` into a `note_tasks` table (note path, text, done, position) — a direct mirror of `note_tags`, built in the existing `reindex_note` path, so it inherits the P0-3 debounce and the P0-5 watcher for free.
- A view listing open tasks grouped by note/folder; click jumps to the task in its note; ticking from the view writes through the normal save path.
- **Dependency:** none. Best value-per-effort in the phase — start here.
- **DoD:** Every unchecked task in the workspace appears in one place within one reindex cycle of being typed; ticking it from the view updates the `.md`; deleting `index.db` and reopening rebuilds the list identically.

### P9-2 — Formula sheet generation — **M**
Many exams allow one A4 formula sheet. Building it by hand is hours of copy-paste from a semester of notes.
- Collect every block-math node across a chosen scope (folder, tag, or workspace) into a **generated note** — plain `.md`, editable afterwards like any other note, printable through P3-2's existing PDF export.
- Deduplicate identical formulas; optionally caption each with the note and heading it came from.
- Generate on demand into a real file. **No live-updating magic file** — a note that rewrites itself behind your back is exactly the kind of thing the plain-`.md` principle exists to prevent.
- **Dependency:** P3-2 (export path). Benefits from P6-1 if theorem blocks exist by then, but doesn't need them.
- **DoD:** Pointing it at a course folder produces one note containing that course's block math, deduplicated, in source order; it exports to a clean printable PDF; editing the result afterwards is ordinary note editing with no regeneration surprises.

### P9-3 — Spaced repetition: **decision fork first** — **decision, then L**

The highest-value study feature and the one with a real architectural catch, so **do not start coding until the storage question is settled.** Review scheduling is data that cannot be rebuilt from the notes, so `index.db` is not an option (principle #1). Three candidates:

- **Option A — inline state in the note (recommended).** Card state as an HTML comment beside each card: `<!-- sr due=2026-08-12 ease=2.5 interval=6 -->`. State is glued to the card, so it survives note renames, folder moves and Git sync with no key-tracking at all — and renames/moves are precisely where this app is known to be weakest (risk #6: note `id` is non-stable, `path` is the real key). Costs: every review writes a note file, and reviews churn Git history.
- **Option B — sidecar file in the workspace.** A `.review.json` synced alongside the notes. Notes stay pristine and reviews never touch them. Cost: cards must be keyed by note path plus card identity, which reintroduces exactly the stable-identity problem the app has so far avoided by never needing one. Editing a card's text or moving its note can orphan its schedule silently.
- **Option C — frontmatter.** Rejected on inspection: cards are per-*card*, not per-note, so a note with twelve cards needs a keyed list in its header — all of Option B's identity problem with none of Option A's locality.

**The sync argument, which is decisive.** The options above were first weighed on rename-survival, but P5 makes a second consequence concrete: **review schedules will be committed and pushed automatically**, so the storage format is also a merge format.

- **Option A** merges as text. Review on two machines and Git reconciles line-by-line; a genuine conflict is human-readable, sitting next to the card it belongs to.
- **Option B** is a single JSON blob. Review on your laptop and your desktop the same day and Git sees one file rewritten on both sides — **a conflict no one can resolve by hand**, in a file whose whole purpose is to be invisible. That is a bad day waiting to happen, and P5-4's fast-forward-only rule doesn't save you: it correctly refuses to merge, so you're left resolving the blob manually anyway.
- **`index.db`** wouldn't sync at all — schedules would diverge silently per machine, which is the worst outcome of the four and the reason principle #1 forbids it regardless.

**Recommendation: Option A**, on three independent grounds. It survives renames and moves with no key tracking, in an app whose note `id` is deliberately non-stable (risk #6). It merges as text under P5's automation. And it keeps the `.md` genuinely self-contained, which is principle #1 applied to a new kind of state. The one real cost — every review writes a note file — is affordable precisely because P0 was done properly: writes are atomic, debounced and conflict-aware, and reviews happen tens of times a day, not per keystroke.

Then, once decided:
- Card syntax over existing notes — cloze deletion for hiding part of a definition, and a `Question :: Answer` form. **P6-1's theorem/proof blocks are natural cards for free** ("state this theorem" / "prove it"), which is the real argument for P6 preceding P9.
- SM-2 scheduling; a review session UI; a derived `review_cards` table in `index.db` for "what's due" queries, rebuildable from the notes.
- **Dependency:** the fork above; P6-1 for theorem-block cards; **this is the concrete trigger for the frontmatter decision** deferred in §5 — if Option A wins, frontmatter may never be needed at all.
- **DoD:** Cards are authored inside normal notes and remain readable as plain Markdown in any other editor; a review session schedules correctly across restarts; deleting `index.db` and reopening loses no scheduling state; moving or renaming a note does not orphan its cards.

**Exit check for M9:** a real course folder yields a usable formula sheet, its open tasks are visible in one place, and a revision session runs off the semester's own notes without any content having been re-entered by hand.

---

## Phase 10 — Gated Stretch (P10) — explicitly gated

**Milestone M10:** *Only after M0–M9 are solid.* The v2 vision from `docs/specs/tech-stack-design.md`. **Do not let these influence P0–P9 design.** *(These were P4-1 and P4-2 before the 2026-07-29 re-scope, then P9-* briefly.)*

### P10-1 — AI assistance over the open note (Claude) — **L**
- An in-app assistant that reads/edits the active `.md` (summarize, explain, generate practice problems, tidy notes). Design it as an *optional* layer over the file — the note stays plain `.md`, and the app remains fully usable with the feature off.
- **Gate:** requires M0 (safe writes) and a settled save-state machine so AI edits go through the same conflict-safe path as human edits. **Also gated on P8 proving insufficient** — if the terminal covers the need, this may never need building at all.

### P10-2 — In-editor code execution (Python / C++) — **L**
- Run fenced code blocks and show output inline. Real sandboxing, toolchain detection, and security review required before this is more than a toy.
- **Gate:** significant security surface; do not start without a dedicated design+security pass.

---

## 4. Challenged / cut / de-scoped features

Per the mandate to remove work that doesn't earn its keep:

| Feature | Verdict | Reasoning |
|---|---|---|
| **Automated OCR→LaTeX PDF pipeline (as spec'd)** | **Cut permanently** — superseded by P4, not revived | Broken skeleton, ~500 MB model + external binaries, degenerate bounding boxes, accuracy ceiling. P4 gets the same *outcome* (a sheet becomes editable Markdown) from the embedded text layer, so the OCR path has no remaining justification. The one thing OCR would still buy — scanned, image-only sheets — is handled by falling back to Pages mode (P4-2), which is the honest answer. |
| **Handwriting search (ink OCR)** | **Cut** | The brief asks search to cover handwritten notes. That needs handwriting recognition — a harder problem than the print OCR just cut, for a much smaller payoff. Ink is for working through a proof, not for archival retrieval; tag or title the note instead. |
| **Graphviz rendering** | **Challenged — not scheduled** | Mermaid already covers flowcharts, sequence, state and class diagrams. Graphviz means shipping a wasm build for the narrow gap (fine-grained graph layout). Revisit only if a real note actually needs DOT. |
| **TikZ export** | **Challenged — not scheduled** | Niche even for this audience, and only useful when handing work to LaTeX. P3-2's PDF export already covers submission. |
| **CodeMirror 6 as the editor** | **Superseded** | The brief named CodeMirror; the app is built on TipTap/ProseMirror, which is what makes WYSIWYG-with-inline-ink possible at all. Recorded so the brief's stack list isn't mistaken for a pending migration. |
| **Cloud sync** | **Cut (stays out of scope)** | Violates local-first principle; plain `.md` + Git/Syncthing already covers it. Invest in *making manual sync painless* (P3-4), not building sync. **Note (2026-07-29):** P5 automates the user's *own* Git against the user's *own* remote. That is this row's remedy taken further, not a reversal of it — the app still builds no accounts, no server, and no sync protocol, and still needs no network to open a note. |
| **Mobile / tablet app** | **Cut** | Desktop + stylus is the whole point; a second platform is a different product. |
| **Collaboration / multiplayer** | **Cut** | Single-user tool; enormous complexity for zero personal value. |
| **Segment-level eraser, hold-to-snap shape recognition** | **Defer indefinitely** | Ink is already a daily-usable subsystem; these are diminishing-returns polish. Only revisit if real use demands it. |
| **Distribution: installers, auto-update, code-signing, cross-platform** | **Out of scope now** | Personal tool. Revisit only if the audience decision changes to "ship to students." |
| **Stable note `id` scheme** | **Defer** | `path` is the working key; don't invest until something actually needs stable IDs (e.g. an external integration). |
| **Multi-window / split-pane editing** | **Defer — reconsider at P4** | Not blocking daily use. But the brief wants the workspace to remember split panes, and P4's "sheet on one side, solution on the other" is the first case with a concrete argument for it. Decide during P4 rather than in the abstract. |
| **Workspace remembers AI conversations** | **Cut** | A brief workspace-memory item that presumes the in-app assistant. With P8 (terminal), conversation history belongs to the CLI tool, not to this app. |
| **Note version history / snapshots** | **Challenged — do the cheap version or nothing** | Considered during the P9 planning pass. Building a snapshot store duplicates what Git already does, and P3-4 already assumes a Git-synced workspace. If this is ever wanted, it is a thin read-only wrapper over `git log`/`git show` for the current note — *not* a second storage system. Anything more is out of scope. |
| **Query blocks / Dataview-lite** | **Challenged — not scheduled** | Powerful, but committing to a query language is a rabbit hole with no natural end, and it would pull metadata design (frontmatter) forward speculatively. P6-5's tag/folder filters plus P9-1's task view cover the realistic 90%. Revisit only if a concrete query is wanted that those two genuinely cannot express. |
| **Lecture audio recording + timestamped notes** | **Cut** | A real student workflow, but a different product surface (capture device, audio storage, playback sync) attached to an app whose entire value is plain-text portability. An audio file is not a `.md`. |
| **Citations / BibTeX / reference manager** | **Cut** | Coursework cites rarely; this is a thesis-writing need, and Zotero already exists. |
| **Presentation / slides mode** | **Cut** | Niche, and P3-2's PDF export already covers sharing a note with a study group. |

---

## 5. Cross-cutting concerns (apply across all phases)

- **Testing:** Keep the existing discipline — pure logic (Rust domain fns, TS `lib/`, `ink/`, `store/`) stays unit-tested; the debounce/save-state machine (P0-1/P0-2) **must** get tests since it guards data integrity. Tauri IPC orchestration hooks remain manually QA'd, per existing precedent.
- **Performance budget:** typing latency is sacred — keep DB work off the keystroke path (P0-3). Search and tree refresh should stay sub-100 ms at a few hundred notes.
- **Observability:** add lightweight logging behind the save/index/watch paths (P0) so a future "did it save?" question is answerable. No telemetry — local logs only.
- **Clippy/typecheck gates:** `cargo clippy -- -D warnings`, `npm run typecheck`, `npm run test` stay green on every commit (per `CLAUDE.md`). Note: there is no `npm run lint` script — don't reference one.
- **Markdown serialization (new, P6-critical):** every custom node must define `addStorage().markdown.serialize/parse`. A node without one serializes as escaped plain text — silent data loss. P6 adds more node types than any previous phase, so this is the phase where that rule gets tested.
- **YAML frontmatter — deferred, with a named trigger (2026-07-29).** The app has no frontmatter support; the title comes from the first heading. Adding it speculatively was considered and rejected: it is infrastructure with no current consumer, and building it "for later" is the premature abstraction the principles warn against. **The trigger is P9-3.** If spaced repetition needs per-note metadata, frontmatter lands then — and if P9-3 takes Option A (inline card state), it may never be needed at all. Do not add it for any other reason without a concrete consumer.
- **Derived-not-authoritative (new, P9-critical):** `index.db` is rebuildable — deleting it must lose nothing. P9 introduces the first state that is neither note content nor derivable from it (review schedules), so every P9 task carries the same test: *delete `index.db`, reopen, is anything gone?* If yes, the design is wrong.
- **External process launching (new, P5/P7/P8-critical):** P5, P7 and P8 are the features that run external programs — `git` for the first, an editor and a shell for the others — and P7-1 does so using text taken from note content. Pass paths as arguments to a configured command, never through a shell; refuse paths escaping the workspace/project root. This is the one genuinely new security surface on the roadmap.
- **Don't touch what you didn't create (new, P5-critical):** P5 is the first feature that writes into a repository the user also works in by hand. Every Git command must be pathspec-scoped to note paths, must abandon rather than repair an unexpected repo state, and must leave staged and unstaged source work untouched. When in doubt, do nothing and say so — a skipped auto-commit costs a few minutes; a wrong one costs trust in the whole feature.
- **In-flight work:** the content-derived-title change to `notes.rs` has landed. A separate hazard was found and fixed during P0: `@tiptap/starter-kit` resolved a nested `@tiptap/core@3.29.1` against the pinned `3.27.4`, making every `Editor`/`Node` type nominally distinct and leaving `npm run typecheck` red on 4 errors. `package.json` now pins `@tiptap/core` and `@tiptap/pm` via `overrides` — don't remove them without re-checking typecheck.

---

## 6. Dependency map (critical path)

Completed phases (P0–P3) are collapsed to their outbound edges; the live critical path is P4-1 onward.

```
[M0–M3 done] ──> P0-5 watcher ────────────────> P8-1 terminal
             └─> P3-1 pdf render + sidecar ──> P4-1 text extraction ──┬─> P4-2 maths crops / scanned fallback
             └─> P2-1 settings ─────────────> P7-4 editor command      └─> P4-3 exercise split + add-next-task
             └─> P2-3 .assets sidecar ──────> P4-2 maths region crops   └─> P6-3 templates
P6-1 proof blocks + collapsible ──┬─> P6-2 algorithm blocks
                                  └─> P9-3 spaced repetition (theorem blocks = cards)
P6-4 equation snippets (independent) ; P6-5 search refinement (independent)
P6-6 outline panel (independent, no backend)
P7-1 deep links ──> P7-2 open-in-IDE ;  P7-4 lands *with* P7-1, not after
P7-3 project awareness (independent)
P5-1 repo detection ──┬─> P5-2 auto-commit ──> P5-3 push policy
                      ├─> P5-4 ff-only pull (independent of P5-2/3)
                      └─> P5-5 repo creation
P7-3 project awareness ──> P5-2's code-repo mode is most useful once this exists
[reindex_note path] ──> P9-1 task view      [P3-2 export] ──> P9-2 formula sheet
P9-3 storage fork ──> P9-3 implementation ──> (frontmatter decision resolves here)
P10-* gated behind M9
```

### Execution order (revised 2026-08-13)

**Phase numbers are identity, not order.** They are referenced across commit messages and 18 design specs, so renumbering would churn all of it for no gain. The order below is what changes; the numbering does not.

| # | Work | Size | Why here |
|---|---|---|---|
| 0 | Finish ruled fractions | — | In flight (`c72a24e`). The named carve-out in P4-2e. |
| 1 | **Freeze the pipeline** under P4-2e | S | Docs, not code. The next 2D shape is the rule's first real application. |
| 2 | Triage the three "Issues Discovered" in `TODO.md` | S | Reported defects on the daily-use path, owned by no phase, sitting above a 371-line plan. Reproduce first — all three are unverified. |
| 3 | **P4-3** → **M4** | M | Closes the milestone. Converts the PDF work from an open hunt into a shut phase. |
| 4 | **Dogfood slice:** P7-3's ignore list → P7-3 → P7-4 + P7-1 together → P8-1 | M/L | *Milestone: this project's own `docs/` lives in null-notes and gets edited there.* |
| 5 | Re-derive P5, P6 and P9 from real use | — | Their current priorities are estimates. Do not plan them further until step 4 has run for a couple of weeks. |

**Why the dogfood slice outranks P5 and P6.** It is the only item on the board that changes what *future* planning is based on — everything else produces a feature, this produces evidence. §1's second closed question records that the daily-use term in §3's formula currently has no supplier; this is the fix. P6 in particular should not be re-planned before it, because §4 of the revision spec found that a whole stream of editor work (`BlockHandle`, `Divider`, `TextAlignment`, `Highlight`, `Kbd`, `HTMLBlock`, `SpanStyle`, `NoteImage`) is happening off-book, which suggests P6's "STEM authoring" scope is the wrong frame for what is actually being built.

*Superseded order, kept for reference: P4-1 → P4-2 → P4-3 → **M4** → P5-* → **M5** → P6-* → **M6** → P7-1 + P7-4 → P7-2 → P7-3 → **M7** → P8-1 → **M8** → P9-* → **M9** → P10.*

Five orderings are deliberate and worth not reshuffling:
- **P4-2 before P4-3** — splitting a sheet whose equations are garbage produces confidently-wrong output.
- **P7-4 alongside P7-1** — a hardcoded editor path would be an immediate rewrite.
- **P5-4 is fast-forward-only, permanently** — the moment auto-pull is allowed to merge, a `.md` can acquire conflict markers that the editor renders as ordinary content. There is no version of "smarter merging" that is worth this.
- **P6 before P9-3** — theorem/proof blocks turn into flashcards essentially for free; building spaced repetition first means building a card authoring format twice.
- **P9-3's fork before any P9-3 code** — the storage choice is not refactorable later; it determines what happens to every existing card when a note is renamed.

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
- **Resolving merge conflicts.** P5 automates commits and fast-forward pulls only. The app never merges, rebases, force-pushes, resets, or edits a conflicted file. When Git needs a human, it gets one.
- **Becoming an IDE.** P7 integrates with your editor; it does not grow into one. No project-wide code navigation, no refactoring, no debugger, no language servers. The moment a P7 task starts wanting a language server, it is out of scope.
```
