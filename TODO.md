# null-notes — TODO

Feature checklist. **The [roadmap](docs/ROADMAP.md) holds the reasoning and the Definitions of Done; this file holds the boxes.** If the two disagree, the roadmap wins.

Effort: **S** ≈ hours · **M** ≈ a day or two · **L** ≈ several days.

**Now:** M2 is closed. Start P4-1.

**Two decisions owed before their phase starts:** split-pane editing (during P4) and spaced-repetition storage (before any P9-3 code).

---

## Progress

| Phase | Milestone | |
|---|---|---|
| P0 Trustworthy daily driver | M0 — I trust it with my real notes | ✅ |
| P1 Everyday-use completeness | M1 — I don't reach for another app | ✅ |
| P2 Feel & ergonomics | M2 — a pleasure to use for hours | ✅ |
| P3 Headline features | M3 — the CS superpowers land | ✅ |
| P4 PDF→Markdown & exercise sheets | M4 — a sheet becomes a workable note | ▶ next |
| P5 Versioned workspaces (Git) | M5 — my notes commit themselves | |
| P6 STEM authoring | M6 — fastest place to write maths | |
| P7 IDE integration | M7 — notes and code are one workflow | |
| P8 Embedded terminal | M8 — `claude` runs against the open note | |
| P9 Study & revision | M9 — the app helps me *revise*, not just capture | |
| P10 Gated stretch | M10 — in-app AI + code execution | gated |

---

## ▸ P4 — PDF → Markdown & exercise sheets (M4) — next up

Both import modes, chosen at import time, the way Notion does it. **No OCR** — typeset sheets carry a real text layer, and `pdfium-render` (already a default dep) hands over per-character bounding boxes and font metrics.

### P4-1 Import mode picker + text-layer extraction — **L**
- [ ] "Pages" vs "Markdown" choice at import; remember the last one
- [ ] Extract the text layer via `page.text()` — chars, bounding boxes, font name/size
- [ ] Reconstruct lines (baseline y) and blocks (vertical gap vs median line height)
- [ ] Headings from font size above the body median
- [ ] Code blocks from monospace font runs
- [ ] Lists from leading bullet/number glyph + indent
- [ ] Bold/italic font variants → `**` / `*`
- [ ] Converted note is a normal editable note, and searchable via `Ctrl+K` *(also closes the brief's "search should include PDFs" gap)*

### P4-2 Honest degradation — **M** — *do before P4-3*
- [ ] Detect maths-font runs (CMMI/CMSY/MSAM/STIX) and crop those regions from the rendered page as inline images, rather than emitting mangled glyph text
- [ ] Detect a near-empty text layer (scanned PDF) *before* converting; explain and offer Pages mode
- [ ] Never produce a garbled or empty note

### P4-3 Exercise splitting & solution scaffold — **M**
- [ ] Split on exercise headings (`Aufgabe N`, `Task N`, `Exercise N`, `Problem N`, `N.`) into `## Task N` + `### Solution` pairs
- [ ] **"Add next task"** command — appends the next correctly-numbered pair, so space per task is never planned in advance
- [ ] No heading match → convert as one unsplit document; never drop content

- [ ] **Decide:** split-pane editing (sheet | solution) — deferred until now, and this is the first case with a concrete argument for it

---

## ▸ P5 — Versioned workspaces / Git automation (M5)

**Not the cloud sync that was cut** — no accounts, no server, no sync protocol. This drives *your* Git against *your* remote, which is P3-4's promise taken from docs to automation. It's the next tier of P0: P0 made the file on disk safe, this makes yesterday's version recoverable.

Two modes, different defaults — everything here follows from this:

| | Notes-only repo | Notes in a code repo |
|---|---|---|
| History is | yours alone | shared, others read it |
| Auto-push | ✅ yes | ❌ **never** |
| Risk to unrelated work | none | high — your source lives there |

> 🔒 **Don't touch what you didn't create.** Pathspec-scope every Git command; abandon rather than repair an unexpected repo state; leave staged and unstaged source work untouched. A skipped auto-commit costs minutes — a wrong one costs trust in the feature.

### P5-1 Repo detection + per-workspace config — **S/M**
- [ ] Detect mode on open: repo root ≈ workspace (notes-only) vs. subtree of a source repo (code repo)
- [ ] Shell out to `git`, **not** `git2`/`gix` — inherits credential helpers, SSH agent, signing, `.gitconfig` for free
- [ ] Per-workspace, machine-local config beside `.workspace.json` (already gitignored) — "should this machine autocommit" isn't a fact about the notes
- [ ] **Opt-in**: detecting a repo prompts once, never starts committing on its own

### P5-2 Batched auto-commit — **M**
- [ ] One commit per session / N minutes idle — never per-save (far coarser than the 600 ms save and 2.5 s reindex debounces)
- [ ] Message summarizes which notes changed
- [ ] **Always `git add -- <paths>` / `git commit -- <paths>`** — never `git add -A`, never a bare commit that sweeps in staged work
- [ ] Skip entirely on mid-rebase/merge/cherry-pick, detached HEAD, or existing conflict markers; report quietly, never repair
- [ ] Run hooks and abort on failure — no silent `--no-verify`; opt-in per-workspace toggle to skip them
- [ ] **Test: staged and unstaged source changes are byte-identical after an auto-commit.** The one unforgivable failure.

### P5-3 Push policy — **S**
- [ ] Notes-only: push after commit (on by default, configurable)
- [ ] Code repo: **never auto-push at any setting** — notes ride along with your next real push
- [ ] Surface no-remote / auth failure / non-fast-forward; never retry blindly, never force

### P5-4 Fast-forward-only auto-pull — **M** — *most dangerous task on the roadmap*
- [ ] Fetch and compare on workspace open (optionally on an interval)
- [ ] No divergent local commits → fast-forward silently (P0-5's watcher already debounces the file burst; P3-4 traced this exact path)
- [ ] Diverged → **stop.** Bar reusing the P0-5 conflict-bar pattern; you resolve it in the terminal (P8) or your Git tool
- [ ] **Never** auto-merge, auto-rebase, or write a conflict marker into a `.md`
- [ ] A dirty buffer is never overwritten by a pull — extends the existing CLAUDE.md rule to the pull path
- [ ] Test: a deliberately diverged history produces **zero** conflict markers in any `.md`

### P5-5 Repo creation for a notes-only workspace — **S**
- [ ] Offer `git init` + the `.gitignore` P3-4 documents when the workspace isn't a repo
- [ ] Optional GitHub remote via `gh repo create` — **private by default**
- [ ] No `gh`? Init locally and print the exact remote command. Never a hard dependency

---

## ▸ P6 — STEM authoring (M6)

> ⚠️ Every new node needs `addStorage().markdown.serialize/parse`. Without one it serialises as escaped plain text — silent data loss.

### P6-1 Proof blocks + collapsible sections — **M**
- [ ] Theorem / Lemma / Corollary / Proof / Definition / Example blocks, optional numbering + title
- [ ] Collapsible sections; collapse state is presentation-only, never touches the `.md`
- [ ] Build on the existing `Callout` node pattern — don't invent a second block mechanism
- [ ] Round-trips through save→reload; prints correctly in PDF export

### P6-2 Algorithm blocks — **M** *(after P6-1, reuse its machinery)*
- [ ] Complexity / Pseudocode / Implementation / References slots
- [ ] Serialises to Markdown that still reads sensibly in any other editor

### P6-3 Templates — **S/M**
- [ ] `templates/` folder in the workspace; "New from template" in sidebar + File menu
- [ ] Minimal placeholder substitution (date, title) — nothing more
- [ ] Ship the P4-3 exercise-sheet layout as the first template

### P6-4 Equation snippets — **S**
- [ ] `/gradient` → `\nabla f(x)` and friends, as one editable table
- [ ] Offered only in a maths context

### P6-5 Search refinement — **S**
- [ ] Filter results by folder and by tag, without leaving the keyboard
- [ ] Recent-searches list, persisted per workspace

### P6-6 Outline / TOC panel — **S**
- [ ] Current note's headings in the right rail, click to jump
- [ ] Highlight the heading currently in view
- [ ] Share the rail with the backlinks panel — no third permanent column
- [ ] Toggle on the P2-2 shortcut layer

> No backend work — heading data is already in the ProseMirror doc. Proposed with the P9 study features but moved here: it's **S** and serves any long note, so parking it behind three phases would waste it.

---

## ▸ P7 — IDE integration (M7)

The brief's second pillar. Notes stay plain `.md` — a deep link is ordinary Markdown that degrades to readable text elsewhere.

> 🔒 First feature to launch external processes **using text taken from note content.** Pass paths as arguments to a configured command, never through a shell; refuse paths escaping the workspace/project root.

### P7-1 Code deep links — **M** *(land together with P7-4)*
- [ ] Recognise `src/main.cpp:58` and `path/file.rs#L20-L30` in note text
- [ ] Resolve relative to workspace root, or project root if the workspace sits inside one
- [ ] Click opens the configured editor at that file and line
- [ ] Unresolvable path renders inert with a "not found" affordance, like an unresolved wiki-link
- [ ] Shell metacharacters in a path cannot cause command execution — **with a test**

### P7-4 Editor command setting — **S** *(not after P7-1 — with it)*
- [ ] Configurable launch command template (VS Code / JetBrains / Neovim) in the settings panel
- [ ] Detect what's installed
- [ ] Switching editors changes where links open, with no code change

### P7-2 "Open in IDE" on code blocks — **S**
- [ ] Action on code blocks that carry a source path, reusing P7-1's launcher and guardrails
- [ ] Appears only when the path resolves — never a dead button

### P7-3 Project awareness & project notes — **M**
- [ ] Open a code repo as a workspace; surface its `README.md` / `docs/` / `notes/` with no import step
- [ ] Opt-in scaffold of `notes/` (Architecture / Meeting / Research / Todo) — **never automatic**, never writes into source folders

---

## ▸ P8 — Embedded terminal (M8)

The brief's AI ask is a *terminal* feature, not an AI feature: no AI code, no API keys, works with any CLI. P0-5's watcher already makes externally-edited files safe.

### P8-1 Terminal pane — **M/L**
- [ ] PTY-backed pane rooted at the workspace
- [ ] Active note's path available as an env var + one-key insert
- [ ] `claude` editing the open note updates the editor through the **existing** watcher path — no new reload logic, no conflict special-case
- [ ] Closing the pane leaves no orphaned process

---

## ▸ P9 — Study & revision (M9)

The only phase not from the brief. Everything before it is *capture*; this is *retrieval* — what happens at exam time.

> ⚠️ Study state is **data, not index.** Deleting `index.db` must lose nothing, so nothing here may keep its only copy in SQLite. Source of truth in the `.md`, derived table rebuilt by `reindex_note` — same shape as `note_tags`. **Test for every task: delete `index.db`, reopen, is anything gone?**

### P9-1 Workspace-wide task view — **S/M** — *start here*
- [ ] Extract `- [ ]` / `- [x]` into a `note_tasks` table (path, text, done, position), mirroring `note_tags`
- [ ] Build it in the existing `reindex_note` path — inherits the P0-3 debounce and P0-5 watcher for free
- [ ] View of open tasks grouped by note/folder; click jumps to the task
- [ ] Ticking from the view writes through the normal save path
- [ ] Delete `index.db`, reopen → identical list

### P9-2 Formula sheet generation — **M**
- [ ] Collect all block math across a scope (folder / tag / workspace)
- [ ] Output a **generated note** — plain `.md`, editable afterwards, printable via P3-2
- [ ] Deduplicate identical formulas
- [ ] Optional caption: source note + heading
- [ ] Generate on demand — **no live-updating magic file** that rewrites itself behind your back

### P9-3 Spaced repetition — **decision, then L**
- [ ] **Decide storage before writing any code** — not refactorable later; it determines what happens to every existing card when a note is renamed
  - **A — inline HTML comment beside each card** *(recommended)*: `<!-- sr due=… ease=… interval=… -->`. Survives renames/moves/Git with no key tracking — which matters because note `id` is non-stable and `path` is the real key. Cost: reviews write note files and churn Git history.
  - **B — `.review.json` sidecar**: notes stay pristine, but cards need stable keys — reintroduces the identity problem the app has avoided by never needing one. Editing a card or moving its note can silently orphan its schedule.
  - **C — frontmatter**: rejected on inspection. Cards are per-*card*, not per-note, so it's all of B's identity problem with none of A's locality.
- [ ] Card syntax: cloze deletion + `Question :: Answer`
- [ ] **P6-1 theorem/proof blocks become cards for free** — the real reason P6 precedes P9
- [ ] SM-2 scheduling + review session UI
- [ ] Derived `review_cards` table for "what's due", rebuildable from the notes
- [ ] Cards stay readable as plain Markdown in any other editor
- [ ] Renaming/moving a note does not orphan its cards

> This is the named trigger for the **frontmatter** decision deferred in the roadmap. If Option A wins, frontmatter may never be needed at all.

---

## ▸ P10 — Gated stretch (M10)

Do not let these influence P0–P9 design.

- [ ] **P10-1 In-app AI assistant** — **L**. Gated on M0 *and* on P8 proving insufficient; if the terminal covers the need, this may never need building.
- [ ] **P10-2 In-editor code execution** (Python / C++) — **L**. Gated on a dedicated design + security pass.

---

## Done

<details>
<summary><strong>P0 — Trustworthy daily driver (M0 ✅)</strong></summary>

- [x] P0-1 Debounced autosave with `clean|dirty|saving|error` state; flushes on tab switch, unmount, window close
- [x] P0-2 Save failures surface with retry; buffer stays dirty on failure
- [x] P0-3 `save_note` writes the file only; `reindex_note` carries FTS/tags/links on a lazier debounce
- [x] P0-4 `write_atomic` — temp file → fsync → rename
- [x] P0-5 Workspace watcher; clean buffers follow disk, dirty ones get a conflict bar
- [x] Real-use soak — no data-loss incident

</details>

<details>
<summary><strong>P1 — Everyday-use completeness (M1 ✅)</strong></summary>

- [x] P1-1 Clicking an unresolved `[[link]]` creates and opens the note
- [x] P1-2 Recent workspaces + `Ctrl+P` quick switcher
- [x] P1-3 Rename a note; inbound `[[links]]` follow
- [x] P1-4 Destructive deletes confirm (was already true on audit)
- [x] P1-5 App identity — `null-notes`, `dev.nullnotes.app`, real README *(app icon still Tauri's default — needs an asset, not a code change)*

</details>

<details>
<summary><strong>P2 — Feel & ergonomics (M2 ✅)</strong></summary>

- [x] P2-1 Settings panel — autosave delay, editor width; persists to `settings.json` in the app data dir
- [x] P2-2 Native File/Edit/View menu + shortcuts overlay, one command dispatcher
- [x] P2-4 Onboarding empty states
- [x] P2-3 Editor niceties — all four boxes:
  - [x] Spellcheck toggle driving both editors, off by default; `#[serde(default)]` so a pre-existing `settings.json` still loads
  - [x] Paste/drop images into a `NoteName.assets/` sidecar as ordinary `![alt](path)` Markdown *(paths are URL-encoded only at the Markdown boundary — sidecar names contain spaces, and a bare space ends a link destination)*
  - [x] Cursor + scroll restored per note across tab switches
  - [x] Backspace at the start of a non-first list item joins into the previous item instead of tearing the list in half

> Append any new annoyance found in daily use to a fresh P2-3 box here rather than opening a new task.

</details>

<details>
<summary><strong>P3 — Headline features (M3 ✅)</strong></summary>

- [x] P3-1 PDF import as reference images; OCR pipeline deleted; pages land in a `NoteName.pdf/` sidecar
- [x] P3-2 Export to PDF via the WebView print pipeline + a `@media print` stylesheet
- [x] P3-3 Connections graph — `d3-force`, ticked to convergence, no per-frame re-render
- [x] P3-4 Git/Syncthing sync guidance *(mostly already true by construction)*

</details>

<details>
<summary><strong>Editing core (pre-roadmap)</strong></summary>

- [x] Live-preview WYSIWYG, plain `.md` as the only format, GitHub Markdown
- [x] KaTeX (inline + block), Mermaid, syntax-highlighted code, callouts, tables, task lists
- [x] Wiki-links + backlinks panel, `#tags` + tag browser, FTS search (`Ctrl+K`)
- [x] Vector ink blocks inline in notes — pen/eraser/shapes, pressure, palm rejection
- [x] Folder tree with create/rename/delete cascade, drag-to-move
- [x] Per-workspace session persistence (open tabs, expanded folders)
- [x] "Terminal Precision" design system

</details>

---

## Not doing

Cut with reasoning in [ROADMAP §4](docs/ROADMAP.md#4-challenged--cut--de-scoped-features). Adding any of these back is a scope change, not a task.

| | Why |
|---|---|
| ~~OCR→LaTeX pipeline~~ | Cut permanently — P4 reaches the same outcome from the text layer |
| ~~Handwriting search~~ | Needs handwriting recognition; ink is for working through a proof, not for retrieval |
| ~~Version history / snapshots~~ | Challenged — Git already does this and P3-4 assumes a Git-synced workspace. If ever wanted, it's a thin read-only wrapper over `git log`, not a second storage system |
| ~~Query blocks / Dataview-lite~~ | Challenged — a query language has no natural end, and it would pull frontmatter design forward speculatively. P6-5 filters + P9-1 task view cover the realistic 90% |
| ~~Lecture audio + timestamped notes~~ | A different product surface bolted onto an app whose value is plain-text portability. An audio file is not a `.md` |
| ~~Citations / BibTeX~~ | A thesis need, not a coursework one; Zotero exists |
| ~~Presentation / slides mode~~ | Niche — P3-2's PDF export already covers sharing with a study group |
| ~~Graphviz, TikZ export~~ | Challenged — Mermaid + PDF export already cover the real need |
| ~~Cloud sync, mobile, collaboration~~ | Local-first, desktop, single-user — all three are a different product. *(P5 automates your own Git against your own remote — that's P3-4 taken further, not a reversal.)* |
| ~~Resolving merge conflicts~~ | P5 commits and fast-forwards only. The app never merges, rebases, force-pushes, resets, or edits a conflicted file |
| ~~Workspace remembers AI conversations~~ | Belongs to the CLI tool once P8 lands, not to this app |
| ~~Becoming an IDE~~ | P7 integrates with your editor. If a task starts wanting a language server, it's out of scope |
| ~~Installers, auto-update, code-signing~~ | Personal tool; revisit only if the audience changes |
| ~~Stable note `id`~~ | `path` is the working key. Re-examine only if P7 needs a durable handle |
| ~~CodeMirror migration~~ | The brief named it; TipTap is what makes WYSIWYG-with-inline-ink possible |
