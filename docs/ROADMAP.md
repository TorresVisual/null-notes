# null-notes — Product & Technical Roadmap

**Last updated:** 2026-08-20 (**P9.5-4 done — interaction & micro-interaction polish.** One curve, two durations (`--ease-standard`/`--duration-fast`/`--duration-base`, the latter kept from `.details-chevron`'s pre-existing value) now back every transition/animation in the app, guarded by `prefers-reduced-motion`; a shared base rule gives every button/row/tab/menu-item its hover-press-focus transition in one place instead of the 50+ individual declarations P9.5-3 found missing it. Every floating surface (modal/popover/menu) now plays one fade-and-settle entrance on mount. Three concretely-silent interactions named in the brief now give feedback: a Git "Committed" status that used to sit in the tab bar forever now auto-reverts to idle after 4s; a ticked task now shows checked-and-struck-through for 320ms before leaving the list instead of vanishing instantly; a newly-created note's tab now gets a brief accent pulse. The folder tree's expand chevron changed from a hard icon-component swap (uncancellable by CSS) to a single rotated icon matching `.details-chevron`'s technique. Every audited interaction — including the ones left deliberately instant, and "note being copied," which doesn't exist as a feature — gets its one-sentence entry in `docs/design-tokens.md`'s new Motion section, per the task's own DoD.)

*Previously, same day: **P9.5-3 done — UI hierarchy & consistency audit.** `docs/ui-consistency-audit.md` documents a one-line primary/secondary/tertiary hierarchy for 15 screens and a per-category consistency table (button heights, icon styles, menu/dialog padding, tooltip delay, input focus, panel borders, empty-state typography, shortcut notation, interaction feel). Real fixes made along the way: six default-rendered unstyled buttons given a shared `.dialog-action` class, a missing `.import-mode-cancel:hover` and `.import-mode-dialog` box-shadow, `.block-handle-menu`'s literal shadow/padding moved onto a new `--shadow-compact` token, a new `--text-empty-state` token unifying seven empty-state selectors, a barely-visible input focus color corrected, `title=` added alongside existing `aria-label` on eight icon-only buttons, mismatched `<kbd>` padding aligned, and the folder context menu's Delete action given the `.danger` color-marking every other destructive menu action already had. Several apparent inconsistencies (icon-size tiers, the two-tier border-radius scheme, one flagged "unstyled button" that turned out to already inherit its parent's style) were reviewed and found to be intentional or non-issues rather than fixed. Out-of-scope findings deferred with reasons to the tasks that own them: empty-state copy wording to P9.5-5, the near-total absence of transitions across every panel/dialog/tab interaction to P9.5-4.)

*Previously, same day: **P9.5-2 done — design-system completeness pass.** `docs/design-tokens.md` names all six typography categories, the surface catalogue, and the interactive-state catalogue. `--font-mono` replaces 12 copies of the same monospace font-stack literal; three named elevation tokens replace three shadow literals repeated across 10 selectors; `--text-heading-1/2/3`, `--text-body`, `--text-display` and `--text-metadata` are wired into real consumers rather than left as documentation only. The three DoD spot-check elements (`.sidebar button`, `.settings-row-control input`, `.tree-row`) each gained the four states they were missing — pressed, focus-visible (a shared `--focus-ring`), loading, error — plus a selected state on the two that lacked one. Two gaps found along the way are recorded rather than silently fixed: `.tree-row` isn't keyboard-focusable yet (no `tabIndex`/keydown), and `.block-handle-menu` uses an unnamed fourth shadow value — both flagged for P9.5-3. One real bug fixed in passing: `.formula-sheet-prompt-input` referenced the undefined `--bg-primary`, rendering with a silently transparent background.)

*Previously, same day: **P9.5-1 done — brand identity, the app icon.** The mark: a broken null-ring pierced by a drawn pencil at 45°, the pencil's diagonal doing double duty as the ring's slash — "null" and "notes" in one gesture instead of two symbols side by side. Landed after several rejected attempts (abstract null glyphs alone, ruled lines or a hollow cursor block added behind an unchanged ring) — putting an actual writing instrument into the same stroke as the null symbol was the change that worked, and it came from a hand-drawn concept (`logos/concept-null-notes.svg`) rather than a generated one. Recolored to the shipped `--accent` green on the ring, pencil kept neutral gray for material contrast; differentiates from sibling product null-ide's plain white-on-gray Ø by silhouette rather than relying on color alone. Generated the full Tauri icon set via `npx tauri icon` and deleted the unused Android/iOS output the generator also produces, since this project doesn't target those platforms. Written identity note at `docs/brand-identity.md` covering what "Terminal Precision" communicates and how its terminal/notebook halves relate, per this task's own DoD.)

*Previously, same day: **P9-3 done — spaced repetition, closing M9.** Cards are authored inline in ordinary notes: a `front :: back` line, or a line with one or more `{{cloze}}` spans, one card per line like every other line-based extractor in this codebase. Schedule state (`due`/`ease`/`interval`/`reps`) is a plain `<!-- sr ... -->` comment written onto the line directly below a card, per the storage decision the roadmap had already resolved (Option A) — never scaffolded until a card is actually reviewed once. `review_cards` is a purely derived table, rebuilt every `reindex_note` from `extract_cards` exactly like `note_tags`/`note_tasks`, wired into the same five rename/remove/forget call sites. Scheduling is SM-2 with four-button grading (Again/Hard/Good/Easy), a pure `sm2::next_state` function taking `today` as an explicit argument rather than reading the clock itself, which made it trivial to test exhaustively. Verified and fixed one real, load-bearing risk *before* writing any storage code: a raw HTML comment is silently dropped by the WYSIWYG editor's own markdown round-trip (`tiptap-markdown` renders to an HTML string, then ProseMirror's `DOMParser` walks Element/Text nodes only, skipping Comment nodes) — confirmed with a throwaway test against the real `coreExtensions`, then fixed with a new `SrState` node using `Callout.tsx`'s own `parse.updateDOM` trick to rewrite the comment into a real element before ProseMirror ever sees it. `ReviewSession` (`Ctrl Shift R`, or Home's now-live Study section) fetches the due queue once, but **re-fetches after every grade rather than caching it** — a real bug found by e2e testing against the compiled app: grading a card inserts a line, which shifts the position of any later due card in the *same* note, so a cached queue's stale position silently failed to grade the next card. Covered by 30 new Rust tests, 18 new frontend tests, and `p9-3-spaced-repetition.e2e.ts` driving the real compiled app end to end. **M9 reached** — P9-1, P9-2, P9-3 and P9-4 are all done.)

*Previously, same day (superseded above): **Phase 9.5 — Productization / Polish added.** A second review pass (`notes/Roadmap-Update2.md`) proposed brand identity, a design-system/UI-hierarchy audit, interaction polish, empty states, error states, product onboarding, an editor-polish re-pass, a micro-interactions pass, and a consistency audit. Five of those nine ideas were first challenged as public-distribution work a single-user tool doesn't need (see §4's struck-through rows) — the maintainer overruled that the same day: wanting the app to feel finished regardless of audience size is a legitimate preference §3 already names ("enjoyment and learning are legitimate terms in the prioritization formula"), not a call this roadmap gets to make on the maintainer's behalf. All nine ideas are now real tasks under the new **Phase 9.5** (P9.5-1…P9.5-8, sequenced after P9 since it polishes surfaces P9 still has to build). The three items briefly parked in §8's polish backlog earlier the same day — empty states, error copy, the consistency audit — moved into P9.5-5/P9.5-6/P9.5-3 instead, so they're tracked once, not twice.)

*Previously, same day (superseded above): **A second review pass (`notes/Roadmap-Update2.md`) proposed a "P9.5 — Productization / Polish" phase — brand identity, a formal design-system/UI-hierarchy audit, interaction polish, empty states, error states, product onboarding, a general editor-polish re-pass, a micro-interactions pass, and a consistency audit.** No new phase was opened for it. Five of the nine ideas are challenged rather than scheduled, for the same reason three ideas were challenged in the first review pass (§4): a brand-identity exercise, a from-scratch design-system audit, and a marketing-style onboarding pass all assume a public-distribution posture that §1 explicitly rules out right now ("not aimed at public distribution yet," branding and onboarding deliberately pushed down the list) — and P1-5's identity cleanup plus P2's already-shipped "Terminal Precision" tokens (M2 reached: "it's a pleasure to use for hours; nothing fights me") cover the same ground a second time with no reported problem driving the redo. The micro-interactions pass and a general editor-polish re-pass are the same shape as ink polish already deferred indefinitely (§4) — no concrete friction named, just more polish for its own sake. What survived: a handful of missing per-surface empty states (search results, backlinks, tasks, Git, graph, terminal) and sharper save-failure copy join §8's polish backlog, and the consistency audit — go through the app, record every visual inconsistency in a table, fix systematically — is recorded there too, unphased, for whenever a polish pass is actually being done rather than as a standing milestone. See §4 for the five challenged rows and their individual reasoning. **Superseded within the hour** — see the current top entry.)

*Previously, 2026-08-19: **P9-2 done — formula sheet generation.** `File > Generate Formula Sheet…` opens a single scope prompt reusing P6-5's `folder:`/`tag:` query syntax (`parseSearchQuery`) rather than a dedicated picker — blank means the whole workspace. `db::notes::notes_in_scope` resolves the matching notes (`search_notes`'s folder/tag SQL minus the FTS match and the 20-result cap, ordered by path for a stable source order), and a new `extract_formulas` scanner reads each note's *current* file content directly from disk — line-based like `extract_tasks`, recognising the same one-liner `$$latex$$` and multi-line `$`/`$$` fence shapes `BlockMath.tsx`'s own markdown-it rule reads, and tracking the nearest `##`+ heading above each formula (a level-1 heading is excluded — it's the note's own title, which the sheet already renders as the `##` group, so counting it too would just repeat the title as a redundant sub-caption). Formulas are deduplicated scope-wide by trimmed latex, first occurrence wins, then grouped consecutively by (note, heading) into `## Note Title` / `### Heading` sections with `$\n<latex>\n$` blocks — the exact form `BlockMath` serializes, so the sheet round-trips through the editor identically to a hand-written one. The generated note goes through the same collision-refusing write path every other generated note uses (`create_note_file_with_content`) — regenerating over an existing sheet fails loudly rather than overwriting, same posture as "no live-updating magic file." One real bug surfaced by e2e testing against the shared fixture workspace: `generate_formula_sheet_at` initially propagated a file-read error for any indexed note whose `.md` was since deleted outside the app, failing the whole sheet over one stale index row — fixed to skip an unreadable note (same posture as `reindex_from_disk`'s own missing-file handling) rather than erroring. Covered by 14 new Rust tests (extraction, scope resolution, dedup/grouping, the stale-index case) and an e2e spec (`p9-2-formula-sheet.e2e.ts`) driving the real compiled app end to end, screenshotted.)

*Previously, same day: **P9-1 done — workspace-wide task view, opening P9.** `- [ ]`/`- [x]` lines extract into a `note_tasks` table (`note_path, text, done, position`), a direct mirror of `note_tags` down to how `rename_path_prefix`/`remove_notes_under`/`update_path` carry it and how `forget_note`/`delete_note` clear it — built into the existing `reindex_note` path per the task's own instruction, so it inherits the P0-3 debounce and P0-5 watcher for free. `position` is the 0-indexed line number, which doubles as the key `toggle_task` uses to flip the checkbox back — simpler than inventing a stable per-task identity, and safe because a toggle rewrites the file and reindexes immediately. Ticking a task from the new `Tasks` view (`Ctrl Shift K`) writes straight to disk via the same atomic-write path every other mutation uses; no new conflict logic was needed because the existing P0-5 watcher already treats that write like any external change — reloading a clean open buffer or conflict-prompting a dirty one. `extract_tasks` tracks fenced-code-block state line-by-line (not `extract_tags`'s strip-then-regex) since removing the fences first would shift the very line numbers `position` depends on.)

*Previously, same day: **P6-6 bug fix — the outline panel froze the app.** User-reported: toggling the outline on an empty note hung the whole WebView, unresponsive, nothing logged. Root cause was the panel's own `MutationObserver`, watching the live ProseMirror contentEditable, reacting to the editor's *own internal DOM housekeeping* (a trailing `<br>` it adds/removes for cursor placement in some browsers) and feeding back into itself — confirmed by dumping the actual `MutationRecord`s under a bounded instrumented rebuild. Fixed by dropping DOM observation entirely: headings are now parsed from the note's own markdown text (`lib/outlineHeadings.ts`, a plain regex), with the DOM read only in direct response to a click or scroll, never watched continuously. Also closed the coverage gap that let this ship undetected: `toggle-outline` was only reachable through the native menu, which WebDriver can't automate — `Layout.tsx` now exposes a narrow `__e2eRunCommand` hook so a real regression spec (`p6-6-outline-panel.e2e.ts`) can drive it and assert the app stays responsive, not just that an assertion passes. Full postmortem in the P6-6 entry below.)

*Same day, earlier: **P6-5 done — search refinement, closing M6.** `folder:`/`tag:`/`type:` narrow a search inline, composing freely with free text and each other; recent searches persist per workspace through the same `WorkspaceState` channel as open tabs. `task:` is the one named extension left out — P9-1's `note_tasks` table doesn't exist yet. Implementing the filters correctly surfaced and fixed a real pre-existing gap: `search_notes` had never scoped to a workspace, so a search could silently return a hit from a different workspace sharing the same `index.db`. **All seven of P6's tasks are done — M6 reached.***

*Same day, earlier still: **P6-7 done — cross-references.** `Theorem 3.2` in prose is now clickable, resolving against a numbered `Callout` block anywhere in the workspace — a `LIKE` match against the FTS index's own stored body (`db::notes::marker_like_pattern`), not a new index. Built as a close structural cousin of P7-1's `CodeLink`: decoration not node, batched-and-cached resolution, unresolved renders inert. Closing the loop needed one gap fixed in `Callout.tsx` — its node view never put `data-callout-type`/`data-callout-number` on the live DOM, so there was nothing for a click handler to find. Six of P6's seven tasks done; only P6-5 remained.*

*Same day, earlier: **P6-6 done — the outline panel.** Headings collected live off ProseMirror's own rendered DOM via a `MutationObserver`, no lifted editor instance and no backend work, per the task's own note. The "share the rail with `BacklinksPanel`" instruction turned out to describe a rail that doesn't exist yet — `BacklinksPanel` is an inline strip, not a persistent column — so `OutlinePanel` sits directly above it in the same flow instead, shown only via **Toggle Outline** (`Ctrl Shift O`). Five of P6's seven tasks done; P6-5 and P6-7 remained.*

*Same day, earlier still: **P6-4 done — equation snippets.** `/gradient` and nineteen others, in one editable table (`src/lib/mathSnippets.ts`). The "maths context" the task named turned out to be a plain `<input>`/`<textarea>` living outside ProseMirror — `SlashCommands`' `Suggestion` plugin structurally cannot see typing there, so the "/" trigger was reimplemented for that one context via a shared `useMathSnippetMenu` hook, not reused. Four of P6's seven tasks done; P6-5 through P6-7 remain.*

*Same day, earlier: **P6-3 done — templates.** `templates/` joins the standard scan-exclusion list, "New from Template" (sidebar + `Ctrl Shift T`) prompts for a note title plus each `{{name}}` a template uses, and `create_note_from_template` writes the filled body verbatim rather than synthesizing a heading. The P4-3 exercise-sheet layout ships as the one required starter template, seeded opt-in — same posture as P7-3's project-notes scaffold — never automatically and never overwriting an edited template. Three of P6's seven tasks done; P6-4 through P6-7 remain.*

*Previously, 2026-08-18: **P6-1 and P6-2 done — proof/theorem blocks, algorithm blocks, and presentation-only collapsible sections.** The collapse-state decision owed since the P6 rescope is resolved: presentation-only, plain component state, never written to the* `.md`*. Theorem/Lemma/Corollary/Proof/Definition/Example/Algorithm are all new* `calloutType` *values reusing the existing* `Callout` *node exactly, per P6-1's DoD ("don't invent a second block mechanism") and P6-2's explicit instruction to reuse it — an algorithm's four slots are bold-labeled paragraphs inside the same blockquote shape, not a bespoke sub-schema. An optional* `number` *attribute (*`> [!THEOREM 3.2]`*) gives P6-7's cross-references a real numbered block to resolve against later. All eight plus the collapsible-section toggle are reachable from* `/`*. Building P6-2 also found and fixed a real pre-existing data-loss bug in* `Callout`*'s parser (a marker line sharing a paragraph with its body text was deleted whole), and filed a narrower, unrelated serializer quirk rather than chasing it. Two of P6's seven tasks done; P6-3 through P6-7 remain.)

*Same day, earlier: a review pass (*`notes/Roadmap-Update.md`*) proposed a batch of P6/P9 additions and a few speculative subsystems. Folded in where they earned their keep: P6-7 (cross-references, reusing P7-1's link-recognition pattern), P6-3 generalized to named placeholders, P6-5 extended with bounded* `type:`*/*`task:` *filter keys, and P9-4 (a workspace dashboard, sequenced as a P9 capstone since it has nothing to show until P9-1/P9-3/P5 exist). A new §8 collects the small editor/navigation polish items with no phase to sit in. Three ideas were challenged rather than scheduled — a per-note document map (redundant with P3-3 + P6-7), source-aware PDF↔note links (would touch the frozen P4 pipeline), and a unified command palette (every action it'd list already has a path via P2-2's menu and P6's slash commands) — see §4.*

*Previously, 2026-08-17: the dogfood slice is complete. P8-1 shipped — a PTY-backed terminal pane (*`portable-pty` *+* `xterm.js`*), toggled with* `Ctrl+\``*, rooted at the workspace, with the active note's path as an env var plus a one-key insert. **M8 reached.** The full slice — P7-3a's scan ignore list → P7-3 → P7-4 + P7-1 → P8-1 — is now done end to end; this project's own* `docs/` *can be opened, edited, and worked on from inside null-notes itself. Same day, P7-2 ("Open in IDE" on a code block that names its own source path) landed too, reusing P7-1's launcher and cache outright — **M7 reached**. §6's step 5 (wait for a couple of weeks of real dogfood use before continuing P5/P6/P9) is now **superseded** — see §1's third closed question, 2026-08-17: the maintainer's mode is implementing and verifying features, not daily use, so the wait never resolves on its own. Step 6 (P5 → P6 → P9) is underway: **P5-1 shipped same day** —* `git rev-parse --show-toplevel`*, canonicalized against the workspace path, classifies notes-only vs. code-repo mode; the opt-in config lives on* `WorkspaceState` *next to* `.workspace.json`*'s other machine-local UI state; no Git command runs until a human answers the one-time prompt. **P5-2 through P5-5 are now also done — M5 reached.** Batched auto-commit is pathspec-scoped and backs off on any unsafe repo state; push never happens for a code-repo workspace, enforced at both the Rust and frontend layers; auto-pull is fast-forward-only, reusing P0-5's watcher for the resulting file changes rather than adding new reload logic; a plain notes folder can become a private GitHub-backed repo in one Settings action.*

*2026-08-13 revision, kept for context — see `specs/roadmap-revision-design.md`: the two weeks before that went almost entirely into PDF pipeline refinement, which the roadmap had no boundary for; that revision added one (§Phase 4, "Pipeline completion criteria"), recorded the app's actual identity and two closed questions (§1), and replaced the execution order in §6 — phase numbers are identity, not order. Ruled fractions landed, freezing the pipeline (§Phase 4, P4-2e); all three open bugs were triaged (two fixed, one didn't reproduce); P4-3 closed M4.*

*Previously, 2026-07-30: M0–M3 all reached — P2-3 closed M2; P4-1 + P4-2 done — PDF→Markdown converts from the embedded text layer with no OCR, and equations are rebuilt as LaTeX rather than mangled into text; re-scoped against* `notes/Plan.md`*; Phases 5 "Versioned Workspaces" and 9 "Study & Revision" added — the first features that go beyond the original brief*.**Audience of this doc:** the maintainer (solo dev). **Product audience:** you — a personal, offline, daily-driver note app for CS coursework. This is **not** aimed at public distribution yet, which deliberately pushes packaging, cross-platform, auto-update, branding, and onboarding *down* the priority list. Correctness, data integrity, and the editor/ink/PDF workflow come first.

---

## How to read this

- **For the actionable checklist, see** `TODO.md`**.** That file holds the boxes; this one holds the reasoning and the Definitions of Done. If they disagree, this file wins and `TODO.md` gets corrected.
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
| --- | --- | --- |
| Freeform 2D canvas (true OneNote) | **Won't build.** Ink-in-flow is the answer; principle #1 below stands unamended. | 2026-08-13 |
| Does the maintainer currently supply the daily-use signal §3 prioritizes by? | **No** — building, not using. Every priority call below M4 is an estimate. This is the argument for the dogfood slice in §6. | 2026-08-13 |
| Will the maintainer actually dogfood for a couple of weeks before P5/P6/P9 continue, per §6 step 5? | **No.** The maintainer's mode is implementing features, verified by "does it work," not lived daily-use friction — that isn't going to change on its own, so a wait gate keyed on it never resolves. **Step 5's wait is dropped.** P5/P6/P9 proceed on the pre-dogfood priority order (§6's "superseded order": P5 → P6 → P9), the roadmap's best estimate rather than an observed one, revised opportunistically if a specific choice proves wrong when actually tried — not via a dedicated observation period that isn't happening. | 2026-08-17 |

The canvas verdict connects to Phase 4's completion criteria: a canvas — objects at x/y — has no Markdown representation, which is exactly why principle #1 blocks it. That is the *same problem* the PDF pipeline keeps hitting. Matrices, `\cases`, stacked fractions and multi-column layout are all "2D layout has no linear representation." One problem, two places — so closing the canvas half while leaving the PDF half open would be inconsistent.

**Non-negotiable principles (already honored by the architecture — keep them):**

1. **Plain** `.md` **is the source of truth.** SQLite is a rebuildable index; deleting it loses nothing. Never invert this.
2. **Offline-first, local-first.** No cloud dependency to open a note.
3. **The file on disk is always safe.** No edit path may silently lose or corrupt a note.
4. **Small, sharp feature set.** Three similar things is not a pattern; don't scaffold half-features.

### The storage boundary

Consistently honored by the code but never written down until now (2026-07-29), which is how invariants get broken by accident. **Where a file lives decides whether it syncs, and that is the entire contract between storage and sync.**

| Inside the workspace folder → **travels with the notes** | In the OS app-data dir → **stays on this machine** |
| --- | --- |
| `.md` notes — the source of truth | `index.db` (`db/mod.rs`) |
| `NoteName.ink/` sidecars (`ink.rs`) | `settings.json` (`settings.rs`) |
| `NoteName.pdf/` page sidecars (`pdf.rs`) | `recent-workspaces.json` (`workspace.rs`) |
| `NoteName.assets/` pasted images (`assets.rs`) |  |
| `.workspace.json` — UI state, gitignored |  |

Both sides are load-bearing:

- `index.db` **is outside** because syncing a binary SQLite file produces conflicts nothing can merge — and it is *safe* to exclude only because principle #1 makes it rebuildable. The two rules hold each other up.
- **Settings are outside** so machine-specific preferences don't fight across machines.
- **Ink, PDF and image sidecars are inside** because a note whose drawings or figures didn't travel with it is a broken note. `NoteName.assets/` (P2-3) is the third of the same shape and needed no new argument — which is the point of having written the rule down.

**The rule for new state:** decide which column it belongs in *before* choosing a file format, because that choice determines whether the format must also be a merge format. P5 makes this concrete — anything inside the workspace is now committed and pushed automatically — and P9-3 is the first feature where getting it wrong would be expensive. Anything that is neither note content nor rebuildable from note content needs an explicit decision recorded here.

---

## 2. Current-state audit

The project is **substantially further along than a greenfield app** — \~3,500 lines of TS/TSX, \~1,900 lines of Rust, real test coverage on the backend and on pure frontend logic, and eight completed design→plan cycles in `docs/`.

### What is solid and shippable today

| Area | State | Evidence |
| --- | --- | --- |
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
  - OCR shells out to an **external** `tesseract` **binary** that must be on `PATH` (`pdf/ocr.rs:14`); nothing installs or bundles it.
  - Equation recovery shells out to a **pix2tex venv** (\~500 MB model) set up manually via `scripts/` (`pdf/equations.rs`).
  - **The bounding boxes are degenerate.** `ocr_page` returns every line with `x:0, y:0, w:1.0, h:0.0` (`pdf/ocr.rs:30-38`), so the equation-crop step crops a **zero-height region** — equation localization cannot work as written. This is the single biggest gap between the spec's promise and reality.
  - Net: PDF import is a research prototype, not a feature. See the explicit **decision fork in Phase 3**.

### Confirmed risks / defects (independently verified in code)

> **Status as of 2026-07-29 — this list is historical.** Risks 1–5, 7 and 8 have been resolved by P0/P1/P2 (see each item's tag below). Risk 6 stands by choice. Kept verbatim rather than deleted because the reasoning is what justifies the save-path rules now codified in `CLAUDE.md`.

1. **Autosave writes on every keystroke with no debounce.** `NoteEditor.onUpdate` → `onChange` → `useNote.save` fires on each edit (`NoteEditor.tsx:30-33`, `useNote.ts:18-25`). Every keystroke = a full file write **plus** a full SQLite reindex of content (FTS), tags, and links (`save_note`, `notes.rs:201-236`). This is a latency and disk-churn problem that will get worse with long notes, and it couples typing latency to DB work. — **✅ fixed, P0-1 + P0-3.**
2. **Save failures are silent.** `save()` awaits `api.notes.save` and discards errors; there is no dirty indicator, no "unsaved"/"save failed" state, no retry. A failed write (disk full, permission, path moved) is invisible → **perceived data loss**. Violates principle #3. — **✅ fixed, P0-2.**
3. **No external-change awareness.** The workspace is scanned only on open. Editing a `.md` in another editor, a `git pull`, or Syncthing landing a change will not refresh the tree, and the FTS index silently goes stale. For a plain-files app this is a correctness gap. — **✅ fixed, P0-5.**
4. **Unresolved wiki-links are dead ends.** Clicking `[[Note That Doesn't Exist]]` does nothing (`WikiLink.tsx:18-20`). The classic "click to create the note" affordance is missing — a real friction point for note-linking workflows. — **✅ fixed, P1-1.**
5. **Wiki-link/backlink resolution is by title string only.** Two notes sharing a title are ambiguous; renaming a note's heading silently breaks inbound links. Acceptable for now, but a known sharp edge. — **⚠️ half fixed, P1-3.** Rename now carries inbound links. Duplicate titles across folders are still ambiguous — unchanged, and still acceptable.
6. **Note** `id` **is non-stable.** A fresh `Uuid::new_v4()` is minted on every scan/save (`notes.rs:159`, `213`, `257`). `path` is the real key; `id` is effectively decorative. Fine today, but don't build anything on `id`. — **🔵 stands, by choice.** See the de-scope table. Re-examine only if P7 (IDE integration) ends up needing a durable handle for deep links.
7. **App identity is boilerplate.** `productName: "tauri-app"`, `identifier: com.moritz.tauri-app`, default 800×600 window, template README (`tauri.conf.json`, `README.md`). Cosmetic for personal use, but trivially fixable and currently makes the app feel unfinished. — **✅ fixed, P1-5**, except the app icon, which is still Tauri's default (needs an asset, not a code change).
8. **No settings/preferences surface** and **no native app menu** — every capability lives behind an in-app button or a single hardcoded shortcut (`Ctrl+K`). — **✅ fixed, P2-1 + P2-2.**

### Capability gap vs. the original brief (`notes/Plan.md`)

M0–M3 cleared the *reliability* backlog, so the question is no longer "is it safe?" but "is it the app the brief describes?" Auditing `notes/Plan.md` line by line against the code, the answer is: the **editing core is complete**, and three of the brief's pillars were never on this roadmap at all.

| Brief capability | State | Where it lands |
| --- | --- | --- |
| Live preview, `.md`-only, GFM, KaTeX, Mermaid, code highlighting, callouts, tables, task lists, wiki-links/backlinks | ✅ Complete | — |
| **Collapsible sections** | ✅ Complete | P6-1 |
| **Templates** | ❌ Missing | P6-3 |
| Vector ink blocks inline in the note | ✅ Complete | — |
| PDF import **as reference image** | ✅ Complete | P3-1 |
| **PDF import → Markdown** (the brief's flagship: OCR → equations → split into exercises) | ❌ Missing; OCR path cut in P3-1 | **P4** — rebuilt without OCR |
| **Exercise/solution structure + "add next task"** | ❌ Missing | P4-3 |
| **Proof blocks** (Theorem/Proof/Lemma/Corollary/Example) | ✅ Complete | P6-1 |
| **Algorithm blocks** (Complexity/Pseudocode/Implementation/References) | ✅ Complete | P6-2 |
| **Equation snippets** (`/gradient` → `\nabla f(x)`) | ❌ Missing (slash-command infra exists) | P6-4 |
| **Terminal running** `claude` **against the open note** | ❌ Missing | **P8** |
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

Given "personal daily driver," priority = `(daily-use value) × (risk of data loss or friction) ÷ effort`. Reliability beats new features; new features beat polish; polish beats distribution; distribution is out of scope for now.

| Phase | Theme | Milestone | Status | Why it's here |
| --- | --- | --- | --- | --- |
| **P0** | Trustworthy daily driver | **M0:** I trust it with my real notes | ✅ | Data-integrity + save-path risks block everything |
| **P1** | Everyday-use completeness | **M1:** I don't reach for another app | ✅ | Small gaps that break flow (links, refresh, quick-switch) |
| **P2** | Feel & ergonomics | **M2:** it's a pleasure to use for hours | ✅ | Compounding daily quality-of-life |
| **P3** | Headline features & power tools | **M3:** the CS-specific superpowers land | ✅ | PDF-as-reference, export, graph |
| **P4** | PDF→Markdown & exercise sheets | **M4:** an exercise sheet becomes a workable note in one step | ✅ | The brief's own flagship; the biggest single time-saver |
| **P5** | Versioned workspaces (Git automation) | **M5:** my notes commit themselves, in both kinds of repo | ✅ | The next tier of P0's data safety — a commit is a recoverable backup |
| **P6** | STEM authoring | **M6:** writing maths/algorithms is faster here than anywhere else | ✅ | Compounds on every note; cheap, since the infra exists |
| **P7** | IDE integration | **M7:** notes and code are one workflow, not two | ✅ | The brief's second pillar — "integrate, don't replace" |
| **P8** | Embedded terminal | **M8:** `claude` runs against the open note without leaving the app | ✅ | Small effort; delivers the brief's AI ask without AI code |
| **P9** | Study & revision | **M9:** the app helps me *revise*, not just capture | ✅ | The only phase not derived from the brief — see below |
| **P9.5** | Productization / polish | **M9.5:** the app looks and feels considered, not just working |  | Explicit maintainer preference — craft is a legitimate prioritization term (below), not gated on audience size |
| **P10** | Gated stretch | **M10:** in-app AI + code execution | gated | Explicitly deferred; do not let it pull focus |

Priority within the new phases follows the same formula (**daily value × friction ÷ effort**), which is why P6 (many small wins on infra that already exists) outranks P7 (a whole new integration surface) despite P7 being the more distinctive feature.

**Why P9 exists (2026-07-29).** Every other phase traces to `notes/Plan.md`. P9 does not, and was added because reviewing the brief exposed a gap in the brief itself: **it is a capture roadmap.** Everything — editing, ink, PDF import, links, graph — helps get material *into* the app. Nothing helps a student get it back *out* at exam time, which is when a study tool either earns its keep or doesn't. It sits at P9 rather than earlier because capture has to be excellent before revision has anything worth revising.

**Why P9.5 exists (2026-08-20).** A second review pass proposed a productization/polish batch that was first challenged as work a single-user tool doesn't need (§4). The maintainer said otherwise: wanting the app to feel finished is a real preference regardless of who else ever sees it, which the "enjoyment and learning are legitimate terms" line above already covers — this table just hadn't given that preference its own row yet. It sits after P9 because it polishes surfaces P9 still has to build first.

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

*Done:* `useNote` *runs a* `clean|dirty|saving|error` *machine, coalescing edits into one write after 600 ms idle; pending writes flush on tab switch, unmount and window close (Rust vetoes* `CloseRequested`*, the UI flushes, then* `confirm_close` *destroys the window). Covered by* `useNote.test.ts`*.*

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

*Done:* `save_note` *writes only the file;* `reindex_note` *carries the FTS/tag/link work on a lazier 2.5 s debounce and is flushed before the tab closes.*

### P0-4 — Crash-safe writes — **S** ✅

Avoid truncated files if the app dies mid-write.

- Write to a temp file in the same directory and atomically rename over the target (`notes.rs` `save_note`, `create_note`).
- **Dependency:** none (can land alongside P0-1).
- **DoD:** Killing the process during a large save never leaves a zero-byte or half-written `.md`; a Rust test writes-then-renames and asserts the target is either fully old or fully new.

*Done:* `write_atomic` *(temp file + fsync + rename) backs both* `save_note` *and* `create_note`*; tests assert the target survives a failed write and no temp files are left behind.*

### P0-5 — External-change refresh — **M** ✅

Keep the tree and index honest when files change underneath the app.

- Watch the workspace directory (Tauri fs-watch / `notify` crate). On change: refresh the tree, re-index changed files, and reload the active note if it changed on disk and the buffer is clean. If the buffer is **dirty** and the file changed externally, surface a conflict prompt (keep mine / reload theirs) — do **not** auto-overwrite.
- **Dependency:** P0-1/P0-2 (needs the dirty-state machine to resolve conflicts safely).
- **DoD:** Editing a `.md` in an external editor updates the sidebar title and search within \~1 s; an external change to the open, unmodified note reloads it; an external change to a dirty note prompts instead of clobbering.

*Done:* `watch_workspace` *(notify, 300 ms debounce) emits* `workspace-changed`*;* `reindex_from_disk` *re-reads changed files and forgets externally deleted ones; a clean buffer follows the disk, a dirty one gets the conflict bar (keep mine / reload theirs).*

**Exit check for M0:** P0-1…P0-5 DoD all met ✅; real-use soak completed with no data-loss incident ✅. The soak did **not** produce a written annoyances list, so P2-3 is seeded from the items already named there rather than from a soak log — see P2-3.

---

## Phase 1 — Everyday-Use Completeness (P1) ✅

**Milestone M1 reached:** *The small gaps that make me switch back to another app are gone.* P1-1…P1-5 all done — links never dead-end (P1-1), recent workspaces plus `Ctrl+P` quick-switching (P1-2), deletes and tab-close were already safe on audit (P1-4), the app has its own identity (P1-5), and renaming a note now carries its inbound `[[links]]` with it (P1-3).

### P1-1 — Create-note-from-unresolved-wiki-link — **S** ✅

- Clicking a `[[missing]]` link creates the note (in the active/selected folder), opens it, and resolves the link. Style resolved vs. missing already exists (`wiki-link-missing`).
- **Dependency:** none.
- **DoD:** Clicking an unresolved link creates `Missing.md` seeded with `# Missing`, opens it in a tab, and the link renders as resolved without a manual refresh.

*Done: a* `useCreateNote` *hook (shared with the sidebar's new-note button) creates the note in the selected folder, adds it to the store — which re-resolves the link on the next render — and opens it. Filenames are derived from titles, so* `create_note` *now refuses to write over an existing file rather than silently destroying it; the collision surfaces in the error banner. Covered by* `useCreateNote.test.ts` *and three* `create_note_file` *tests.*

### P1-2 — Quick-switcher / recent workspaces — **M** ✅

Right now switching workspaces means re-picking a folder every time; there's no jump-to-note.

- Persist a **recent workspaces** list; offer a picker instead of only the OS folder dialog.
- Extend `Ctrl+K` (or add `Ctrl+P`) to jump to a note by title across the current workspace, keyboard-navigable.
- **Dependency:** none.
- **DoD:** Reopening the app offers the last workspaces without a folder dialog; `Ctrl+P` opens any note by fuzzy title in ≤3 keystrokes for a typical name.

*Done: the backend keeps an app-data-dir* `recent-workspaces.json` *(most-recent-first, capped at 8);* `WorkspacePicker` *replaces the empty state with that list plus a folder-dialog fallback, and filters out workspaces that no longer exist without forgetting them.* `Ctrl+P` *opens* `QuickSwitcher`*, which ranks the in-memory notes list by title-match position (prefix beats mid-title) with no backend round-trip. Covered by* `workspace.rs`*'s recents tests,* `pathPrefix.test.ts`*,* `useCreateNote`*-adjacent store tests, and* `QuickSwitcher.test.ts`*.*

### P1-3 — Note rename that preserves links — **M** ✅

Today "title = first heading" and there's no note rename; renaming a heading silently breaks inbound `[[links]]` (risk #5).

- Provide an explicit rename (heading + optionally filename) that rewrites inbound wiki-link targets across the workspace, or records an alias.
- **Dependency:** P1-1 (link machinery), P0-5 (index refresh).
- **DoD:** Renaming a note updates every inbound `[[old]]` to `[[new]]` (or preserves resolution via alias); a backend test covers the cascade, mirroring the existing folder-rename test.

*Done:* `rename_note` *rewrites the target note's heading (or prepends one if it had none) and walks* `backlinks_for(old_title)` *— already the exact case-insensitive set that resolves* `[[links]]` *to this note — rewriting* `[[old]]` *to* `[[new]]` *in every one of them and reindexing. Filename is deliberately left untouched (scope is heading-only, per risk #6:* `path`*, not title, is the real key), so a currently-open backlinking note picks up the rewrite through the existing P0-5 watcher/reload path with no special-casing needed. A pencil button next to each note's delete button in the sidebar prompts for the new title. Six backend tests cover the heading rewrite, the link rewrite, and the end-to-end cascade against an untouched third note.*

### P1-4 — Delete/close UX safety — **S** ✅

- Confirm destructive folder/note deletes (folder delete is a recursive `remove_dir_all`, `notes.rs:376-381`). Confirm closing a tab with unsaved (should be impossible after P0-1, but guard anyway).
- **Dependency:** P0-1.
- **DoD:** Deleting a non-empty folder requires confirmation naming the count of affected notes; no delete path is a single misclick.

*Done: already satisfied by existing code, found true on audit rather than newly built.* `TreeNode.tsx`*'s note delete and* `FolderContextMenu.tsx`*'s folder delete (which names the affected note count) both guard with* `confirm()`*. Closing a tab was already impossible to lose data on:* `useNote`*'s* `useEffect(() => () => void flush(), [path, flush])` *flushes any pending write the instant* `activeTab` *changes away from a note, so a background tab never carries an unflushed edit by the time its tab is closed.*

### P1-5 — App identity cleanup — **S** ✅

Cheap, removes the "unfinished template" feel.

- Set `productName`, `identifier`, window title/size defaults, app icon; rewrite `README.md` to describe null-notes (it's currently the Tauri template readme).
- **Dependency:** none.
- **DoD:** Built app shows "null-notes" everywhere; README documents what the app is, how to run it, and the storage model.

*Done:* `productName`*/*`identifier`*/window title are "null-notes" /* `dev.nullnotes.app`*, default window grew from the template's 800×600 to 1280×800; the Cargo package and lib crate are renamed (*`null-notes` */* `null_notes_lib`*) and* `package.json` *follows. README rewritten to describe the app, storage model, and run/build commands. App icon left as Tauri's generic default — swapping it needs an actual icon asset, not a code change, so it's deferred rather than silently done.*

**Exit check for M1:** links never dead-end, jumping around is fast, renames don't break references, and the app no longer looks like a template.

---

## Phase 2 — Feel & Ergonomics (P2) ✅

**Milestone M2 reached (2026-07-29):** *Long editing sessions feel good; nothing fights me.* P2-1, P2-2 and P2-4 were already done; P2-3 was the last box and is now cleared. It was no longer DoD-satisfiable as originally written — the M0 soak produced no annoyances list — so it was re-specified against the four concrete items it already named, all four of which shipped.

The visual-design and editor-feel passes are already done (`docs/plans/visual-design-system.md`, `editor-feel.md`). This phase is the remaining ergonomics layer.

### P2-1 — Settings / preferences surface — **M** ✅

- A minimal settings panel: theme (if more than one), editor max-width/typography, autosave debounce interval, default workspace, spellcheck toggle. Persist to a config file (not SQLite — SQLite is a rebuildable index).
- **Dependency:** P0-1 (autosave interval becomes a setting).
- **DoD:** Changing a setting persists across restarts and takes effect without a reload where feasible.

*Done (commits* `6c21c5f`*,* `0b42917`*) — this was shipped but never ticked here.* `AppSettings` *(autosave debounce, editor max width) persists to* `settings.json` *in the app data dir, deliberately **not** in SQLite (rebuildable index) and **not** in the workspace (app-wide preference, not per-workspace state) — same home as* `recent-workspaces.json`*.* `SettingsPanel` *writes through a Zustand store so changes apply live with no reload. Two of the bulleted settings are **not** built: theme (there is only one theme, so the control would be a no-op — deliberately not scaffolded) and the spellcheck toggle, which moves to P2-3 where the rest of the editor-niceties work lives.*

### P2-2 — Keyboard-shortcut layer + native menu — **M** ✅

- A native app menu (File/Edit/View) and a discoverable shortcut sheet. Wire the actions that already exist (new note, new folder, search, toggle raw/WYSIWYG, insert ink).
- **Dependency:** P1-2 (quick-switcher shortcut should be registered here too).
- **DoD:** Every primary action has a keyboard path; a `?`/shortcut overlay lists them; menu items work.

*Done: a native File/Edit/View menu (*`build_menu` *in* `lib.rs`*) carries every primary action with its accelerator (New Note, New Folder, New Canvas Note, Open Workspace, Settings in File; clipboard actions in Edit; Search, Quick Switcher, Toggle Source/Preview, Insert Ink Block, Keyboard Shortcuts in View).* `on_menu_event` *emits one* `menu-action` *event;* `Layout.tsx`*'s* `runCommand` *is the single dispatcher both the menu and (for* `?`*, which has no natural accelerator) a narrow DOM listener call into — deliberately one source of truth per action so a native accelerator and a DOM keydown handler can't double-fire the same command.* `useCreateFolder`*/*`useCreateCanvasNote` *were extracted from Sidebar (mirroring* `useCreateNote`*) so the sidebar buttons and the menu share logic instead of duplicating it. "Insert ink" reaches the focused note via a plain* `command:insert-ink` *window event rather than lifting the TipTap editor instance up to* `Layout`*.* `ShortcutsOverlay` *lists all nine shortcuts.*

### P2-3 — Editor niceties audit — **S/M** ✅

The M0 soak is done but produced no written annoyances list, so the original DoD ("clear the checklist from the soak") could never be satisfied as written. Rather than leave the task blocked forever on a log that doesn't exist, it was re-specified against the four items it already named — each independently verified as genuinely missing at the time:

- [x] **Spellcheck toggle.** `RawEditor.tsx:12` hardcoded `spellCheck={false}` and the WYSIWYG editor set nothing at all. Wired both to a setting (the one P2-1 deliberately left out).

- [x] **Paste/drop an image into a note.** No paste or drop handler existed anywhere in `src/editor/` — the only `handleDrop` in the codebase was `TreeNode.tsx`'s file-move. Now stores the image beside the note (the `NoteName.ink/` / `NoteName.pdf/` sidecar pattern) and inserts a standard Markdown image.

- [x] **Focus/scroll restoration across tab switches.** Switching tabs and returning dropped you at the top with no cursor.

- [x] **Stable list behavior** on Enter/Tab/Backspace at list boundaries.

- **Dependency:** none (P2-1 for the spellcheck setting's home).
- **DoD (revised):** All four boxes above are ticked, or explicitly struck with a reason. Any *new* annoyance found in ongoing daily use gets appended here rather than opening a fresh task.

*Done. **Spellcheck** is one* `AppSettings` *field driving both editors, defaulting **off**, which the raw editor had already hardcoded. The field is* `#[serde(default)]` *because* `settings.json` *had already shipped without it; a file written by an older build must keep loading rather than dropping the user back to defaults. The toggle goes through* `setOptions` *because ProseMirror re-applies* `editorProps.attributes` *on every state update, so setting the DOM attribute directly would be undone on the next keystroke.*

*The first cut was a blanket on/off, and that made the setting close to worthless: turned on, a note is a wall of red under every identifier,* `\alpha` *and note title. Because the* `spellcheck` *attribute is **inherited by descendants**, the fix is to mark the non-prose nodes* `false` *and let them carve themselves out of an editor-wide* `true` *— code blocks, inline code, inline and block maths, mermaid, tags and wiki-link targets. Callouts deliberately stay in; they hold ordinary prose. Code block and inline code take it through* `HTMLAttributes` *rather than a* `renderHTML` *override — same result, no duplicated markup — and are covered by tests asserting the attribute on the real DOM. The five React node views set it on* `NodeViewWrapper`*, which forwards arbitrary props; those are **not** covered, because a bare* `Editor` *renders only the* `renderHTML` *shell and testing a node view needs the full React tree.*

*Two things worth remembering here. The* `.settings-row-control input` *rule was written for the panel's number inputs, so the new checkbox silently inherited* `width: 72px` *and a dark background — it rendered as a wide box with no visible tick, which reads as a broken feature rather than a styling bug. And whether squiggles appear at all is a **WebView2/OS capability**, not something this code controls: Chromium on Windows uses the OS spell-checking language pack, and WebView2 does not fetch Hunspell dictionaries the way desktop Chrome does. If a machine shows no squiggles in the raw-Markdown* `<textarea>` *either, the setting is working and the platform isn't.*

***Images**** land in a* `NoteName.assets/` *sidecar — the third of the same shape, inside the workspace per §1's storage boundary, because a note whose figures didn't travel with it is a broken note. The note itself gets an ordinary* `![alt](path)`*. Two things only the round-trip tests would have caught: sidecar directories are named after the note and so routinely contain spaces (*`Lecture 7.assets/`*), and a bare space ends a Markdown link destination — the image silently stopped being an image on the next reload. The attribute now holds the raw filesystem path and encoding happens only at the Markdown boundary; storing the encoded form would need an idempotent encoder and* `encodeURI` *is not one (it escapes* `%`*, so every save grew* `%20` *into* `%2520`*).* `read_note_asset` *resolves a path taken from hand-editable note content, so anything but a plain forward-relative path is refused rather than normalised — the §5 "external process / untrusted path" rule applied to file reads.*

***Cursor and scroll**** are remembered per note path in a session-scoped module map — the editor unmounts while the next note loads, so neither can live in component state. Deliberately not persisted: where the cursor sat is not note content. The cursor is recorded on* `selectionUpdate`*, not on unmount, where the editor is already destroyed by the time a cleanup could read it.* `focus()` *had to be called with* `scrollIntoView: false`*: it scrolls from inside a* `requestAnimationFrame` *that lands after the scroll restore and overrode it — when the two disagree, what the user was looking at wins over where the cursor was.*

***Lists*** *had one real defect, found by writing the boundary cases out as tests: TipTap's* `ListKeymap` *answers Backspace-at-item-start with* `liftListItem` *unconditionally, so backspacing at the start of the second item tore the list in half and left a paragraph wedged between the pieces. That case is now claimed ahead of* `ListKeymap` *and joined into the previous textblock; lifting stays correct for the first item, which* `ListKeymap` *still handles. The other three behaviours (Enter-exits, Enter-outdents-nested, Tab/Shift-Tab) were already correct and now have tests. Two incidental findings: StarterKit 3 bundles its own* `Link`*, so the app was registering the name twice and its own* `openOnClick`*/*`autolink` *config was the one that lost — now disabled in StarterKit. And the serializer emits a blank line before a nested **task** list but not a nested bullet list; it round-trips to the same structure, so it is left alone and recorded here rather than chased.*

*One methodological note worth keeping: the first version of the list tests mounted the editor without* `NoteEditor`*'s* `editorProps`*, so the handlers under test were not installed at all and the tests passed against an editor the app never builds. Any test of key handling has to mount the real configuration.*

**Exit check for M2:** P2-3 cleared ✅. P2-1, P2-2, P2-4 already done ✅. **M2 reached (2026-07-29).**

### P2-4 — Empty/onboarding states — **S** ✅

- The current empty state is one line ("Open a workspace and select a note"). Add a friendly first-run: pick/create a workspace, create your first note, a hint at `Ctrl+K`/`Ctrl+P`.
- **Dependency:** P1-2.
- **DoD:** A brand-new user (or a fresh workspace) has an obvious next action at every step.

*Done: pick/create a workspace was already covered by P1-2's* `WorkspacePicker`*. A workspace with zero notes now shows an onboarding hint in the sidebar (pointing at New Note / Ctrl N) instead of a blank tree, and the main pane's empty state branches on whether the workspace has any notes — "create your first note" when it doesn't, "jump to one / press ?" when it does.*

---

## Phase 3 — Headline Features & Power Tools (P3) ✅

**Milestone M3 reached:** *The CS-specific superpowers that justify a custom app are real.* P3-1…P3-4 all done: PDF import as a reference image (no broken OCR pipeline), export to PDF via the WebView's print pipeline, a force-directed connections graph, and sync guidance that turned out to already be true by construction.

### P3-1 — PDF import: **decision fork** (do this first in P3) — **decision, then L** ✅ Option A shipped

The current pipeline is a broken skeleton with heavy external dependencies (audit §2). Per the brief's mandate to challenge low-value work, **do not "finish" it by default.** Choose one:

- **Option A — Descope to "PDF as reference" (recommended).** Import a PDF as an attachment and render its pages alongside the note (or into image blocks) so you can transcribe/annotate manually. No OCR, no pix2tex, no tesseract, no 500 MB model, no bundling headache. Delivers \~80% of the daily value (having the sheet next to your solution) for \~20% of the effort, and is fully offline with zero external binaries.
  - **DoD (A):** Drag-drop or "Import PDF" turns the default `pdf-native` feature **on** (or replaces pdfium with a lighter render path), renders pages to images stored beside the note, and inserts them as viewable blocks. No dependency on `tesseract`/pix2tex. Works in a default `cargo build`.
- **Option B — Actually build the OCR→LaTeX pipeline.** Only if automated exercise extraction is a must-have. Requires: real per-word bounding boxes (tesseract TSV output, not `--psm 1` line text — fixes the degenerate-bbox defect at `pdf/ocr.rs:30-38`), reliable region grouping, bundling or first-run-installing tesseract + pix2tex, and the exercise-boundary heuristic from `docs/specs/tech-stack-design.md`. This is an **L+ research effort** with an accuracy ceiling; treat it as a spike with a go/no-go gate, not a committed feature.
  - **DoD (B):** A 20-page typeset sheet imports in &lt;10 s (spec target) into `ExerciseBlock`s with editable extracted text and best-effort LaTeX, on a machine set up by a documented one-command installer; failure modes degrade to plain text, never crash.

**Recommendation:** Ship **Option A** now; keep **Option B** as an optional spike behind a feature flag. Don't block M3 on B.

*Done (Option A):* `pdf-native` *is now a default feature —* `pdfium-render` *is a pure-Rust binding crate with no native-binary requirement at compile time, so a default* `cargo build` *still succeeds; only an actual import at runtime needs the pdfium library present, and that fails with a clean error rather than a crash if it's missing.* `ocr.rs`*,* `equations.rs`*,* `parser.rs`*, and the dead* `ExerciseBlock` *node (no markdown serialize, never actually inserted by the old pipeline) are deleted rather than kept as a "spike behind a flag" — the audit already established the OCR code was broken (degenerate bounding boxes) and unsalvageable without a rewrite, so there was nothing worth preserving. Pages render straight into a* `NoteName.pdf/` *sidecar directory next to the note (mirroring* `NoteName.ink/`*) instead of the old code's leaked temp directory — fixes a real unbounded-disk-growth bug as a side effect. A new* `PdfPageBlock` *node (mirroring* `InkBlock`*'s markdown fenced-block pattern) displays each page as an image, loaded via a* `read_pdf_page` *→ base64 IPC call rather than the Tauri asset protocol, keeping the same "binary data over IPC" shape* `read_ink` *already established rather than introducing a new capability/permission surface.*

### P3-2 — Export (print / PDF / HTML) — **M** ✅ PDF via print

High daily value for a student (submitting or sharing notes) and currently absent.

- Export the active note (and its rendered ink/math/mermaid) to PDF and/or standalone HTML. Leverage the WebView's print pipeline where possible.
- **Dependency:** none (but nicer after P2 typography settings).
- **DoD:** A note with math, a code block, a Mermaid diagram, and an ink block exports to a PDF that visually matches the editor.

*Done (PDF path): File &gt; Export to PDF calls the WebView's own* `window.print()` *— since math (KaTeX), Mermaid (already configured with* `theme: 'default'`*, print-safe out of the box), code highlighting, and ink (rendered SVG) are all live DOM content by the time export runs, printing captures them exactly as shown with zero custom rendering code. The only real work was a* `@media print` *block: it redefines the dark-theme CSS custom properties to a light, print-safe palette (including per-callout-type light backgrounds, since those use their own hardcoded dark colors rather than the shared tokens), hides app chrome (sidebar, tab bar, toolbars, status bar, backlinks panel), and adds page-break-avoidance around headings/code/tables/ink/PDF-page blocks. If the raw-markdown view is active, export switches to the rendered view first — printing raw text wouldn't match the editor. Standalone HTML export (the "and/or" half of the DoD) is not done — PDF alone satisfies the DoD's visual-fidelity requirement, and bundling a truly standalone HTML file (inlined KaTeX/highlight.js CSS) is a separate, harder problem not worth scope-creeping into this pass. Visual output wasn't independently re-verified beyond CSS review — worth a manual check against a note with all four content types before fully trusting it.*

### P3-3 — Knowledge graph / connections view — **M/L** ✅

The data already exists (`note_links`, backlinks). A local graph of notes↔links↔tags is a natural, high-value power feature for revision.

- **Dependency:** P1-1/P1-3 (link integrity), P0-5 (fresh index).
- **DoD:** A view renders notes as nodes and `[[links]]`/shared tags as edges; clicking a node opens the note; it stays responsive at a few hundred notes.

*Done:* `graph_links`*/*`graph_tags` *hand over every link/tag row in the workspace at once (new, alongside the existing per-title/per-tag* `backlinks_for`*/*`notes_with_tag`*);* `buildGraph` *(pure, tested) resolves them into deduplicated nodes/edges — link resolution matches how* `[[links]]` *resolve everywhere else (case-insensitive title match, unresolved links dropped rather than shown as dangling nodes), notes sharing a tag get a pairwise edge. Layout uses* `d3-force`*, run to convergence synchronously via manual* `.tick()` *calls rather than an animated* `.on('tick')` *loop, so the graph renders once, fully settled — no per-frame re-renders regardless of note count.* `View > Connections Graph` *(*`Ctrl+G`*) opens it; clicking a node opens the note. Viewbox auto-fits to the settled layout's bounding box so the graph is never clipped at any size.*

### P3-4 — Manual sync guidance, done well — **S** ✅

Sync is out of scope as a *feature* (principle #2), but since files are plain `.md`, make Git/Syncthing painless.

- A sensible `.gitignore` (index.db, tmp, ink temp), docs on the recommended sync setup, and — after P0-5 — graceful handling of files appearing/changing from a sync client.
- **Dependency:** P0-5.
- **DoD:** A documented Git-based sync round-trip (edit on machine A, pull on machine B) works without index corruption or manual re-scan.

*Done: mostly already true by construction, this was a documentation + verification pass rather than new code.* `index.db` *was never inside the workspace to begin with (it lives in the OS app-data dir — the README's "sits alongside the workspace folder" was actually wrong, fixed while here), so there's nothing workspace-side to gitignore for it. Traced the actual round-trip:* `watch_workspace`*'s debounce already batches a burst of changes (exactly what a* `git pull` *touching many files produces) into one* `workspace-changed` *event;* `useExternalChanges` *reindexes every changed path in parallel and refreshes the tree once, and* `reindex_from_disk`*'s existing not-found fallback (*`forget_note`*) already handles a file a pull deleted. README documents the setup and a minimal workspace* `.gitignore` *(*`.workspace.json` *— UI state, not content — and stray crash-temp files). Not literally tested across two physical machines; verified by tracing the code path rather than an end-to-end run.*

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

*Done. The import dialog asks Pages or Markdown per import and remembers the answer in* `settings.json` *(app-wide machine-local preference, same home as the autosave delay). The converted note is created through the ordinary* `create_note`*/*`save_note`*/*`reindex_note` *path, so it is editable and* `Ctrl+K`*-searchable with no special casing — the brief's "search should include PDFs" gap closes as a side effect, exactly as predicted.*

***The structural decision:*** `pdf/layout.rs` ***takes plain*** `CharBox` ***values, not pdfium types.*** *That is what makes the algorithm testable at all — the test machine has no pdfium, and the two pre-existing render tests are* `#[ignore]`*d for exactly that reason. Keeping the judgement in a pdfium-free module bought 22 real tests driven through a small typesetter that lays glyphs out the way a PDF does;* `pdf/extract.rs` *is the thin translation layer and carries no decisions.*

*The pdfium API turned out **better than this phase assumed**:* `font_is_fixed_pitch()` *gives code-block detection with no font-name list, and* `font_weight()`*/*`font_is_italic()` *give emphasis directly. Font-name matching is only still needed for P4-2's maths detection.*

*Three things the tests forced, each a real bug rather than a tuning preference:*

- *Baseline tolerance scales by the **larger** of the two font sizes. A superscript sorts above the line it belongs to, so anchoring to the row's first character let it set the tolerance from its own tiny size and reject its own line.*
- *The line-gap median is the **lower** one. Line gaps outnumber paragraph gaps, so with only a couple of gaps to judge from, rounding toward the smaller is what keeps a paragraph break detectable.*
- *Emphasis padding sits **outside** the markers —* `**word ** after` *is not emphasis in Markdown.*

*Also:* `loose_bounds()` *rather than* `tight_bounds()`*, because tight bounds cover a glyph's inked extent and a comma would then leave a gap wide enough to fake a space after every one. Conversion runs in* `spawn_blocking` *(pdfium is synchronous) and **before** the note is created, so a failed conversion leaves no empty note behind.*

*Scanned-PDF detection landed here rather than in P4-2 because it was five lines and P4-1 must not produce a garbage note. The other half — actually offering Pages mode rather than only naming it — shipped with P4-2.*

*Not verified against a real PDF — pdfium is not present on this machine, so the whole pdfium-facing path (*`extract_pages_native`*) is compile-checked only. The geometry it feeds is thoroughly tested; the translation into it is not.*

### P4-2 — Honest degradation: maths regions and scanned PDFs — **M** ✅

The two ways P4-1 can produce garbage. Both must fail visibly, never silently.

- **Maths.** LaTeX-rendered equations have no LaTeX in the PDF — they are glyph runs in maths fonts (CMMI/CMSY/MSAM/STIX). Extracting them as text yields mangled nonsense. Detect maths-font runs and **rebuild LaTeX from the glyph geometry and the face each glyph came from**, rather than emitting flat text.
- **Scanned PDFs.** A near-empty text layer means there is nothing to convert. Detect it up front, say so plainly, and offer Pages mode instead of producing an empty or garbled note.
- **Dependency:** P4-1.
- **DoD:** A sheet with display and inline maths imports with every equation as valid, copyable LaTeX (`$…$` / `$$…$$`), not as corrupted text. A scanned PDF is detected before conversion and routed to Pages mode with an explanatory message — it never produces a garbage note.

*Done in two passes — the first shipped, the second replaced it, and both are worth keeping on the record because the reason for the reversal is a real design lesson.*

***Pass one cropped the region as an image****, verified by rendering the crops and looking at them:* `f : ℝ² → ℝ`*,* `f(x, y) = √(x² + y²)`*,* `(x₀, y₀) = (3, 4)` *all visually exact. It stood as the shipped answer for about a day. **The user then named the actual use case — pasting a converted sheet into an LLM prompt — and an image cannot be copied into a prompt, searched, or edited, and it never went through the editor's own KaTeX pipeline that P2-3's InlineMath/BlockMath nodes already provide.** That is a materially different requirement than "looks right," and crops fail it categorically, not partially. Rebuilt as LaTeX instead.*

***What makes LaTeX recoverable at all: which face a glyph came from carries most of its meaning.**** Computer Modern splits mathematics by role, not by look —* `CMMI` *variables,* `CMSY` *relations,* `CMEX` *extensible glyphs,* `MSBM` *blackboard bold,* `RSFS`*/*`EUFRAK` *script and fraktur.* `pdf/maths.rs` *classifies the face;* `pdf/latex.rs` *turns face plus geometry (smaller and off-baseline → a script; consecutive upright letters → an operator name) into LaTeX. Pure and pdfium-free, so it is unit-tested the same way* `layout.rs` *is.*

*Four bugs the real document forced, each invisible in a synthetic fixture:*

- ***A radical is set on its own baseline above its radicand.*** `√(x²+y²)` *arrived as two separate lines and rendered* `\sqrt{}` *next to a stray expression. A row made only of extensible glyphs now folds into the row beneath it before line-building runs.*
- ***The subscript offset threshold was sized for exponents.*** *TeX drops a subscript far less than it raises a superscript — 1.8pt vs 4.4pt on a 12pt line — so every subscript was silently absorbed into the base expression:* `T_3` *read as* `T3`*.*
- ***A maths region is a direct slice of the page's character row, bypassing*** `layout.rs`***'s own gap-based space synthesis.*** `= √(...)` *lost its space and became* `=\sqrt{...}`*. Redone locally in* `latex.rs` *against the same* `SPACE_GAP` *constant.*
- ***A footnote marker is a raised, reduced-size digit glued onto the period after an equation — geometrically identical to a real exponent except for what it follows.*** *An exponent never sits directly after terminal punctuation, so region growth now stops right after including* `.`*/*`,`*/*`;`*/*`:`*/*`!`*/*`?` *if what follows is itself a script.* `T_2(...).3` *no longer reads* `T_2(...).^3`*, and ordinary mid-expression commas and digits are untouched.*

*Also: a radical's trailing sentence punctuation is trimmed out of* `\sqrt{}` *— the vinculum is a drawn rule, not a character, so where the radicand ends is already a guess (*`RADICAL_TAKES_REST`*), and swallowing the sentence's own full stop was an avoidable part of that guess.*

*Scanned detection **offers** Pages mode rather than only naming it — the button was the missing half flagged in P4-1.*

***Known and deliberately out of scope:**** multi-line vector/matrix notation — a gradient dotted into a stacked column, a Hessian — has no single-baseline representation at all and comes out as glyph-order text, not valid LaTeX. This is a structurally different problem (2D layout, drawn brackets) rather than a tuning gap in the current approach.* `throwOnError: false` *on both maths nodes means a bad equation renders KaTeX's own inline error rather than breaking the note or anything around it, so the failure is contained — but it is a real gap, not a hidden one.*

***Hyphenation, fixed after all.**** The paragraph below was written the same day the limitation was found and stood as the record for about as long as it took to get real evidence: pdfium reports a discretionary hyphen as* `U+0002` *with its own* `is_hyphen()` *flag set, and it was being discarded by the synthetic-character filter as an ordinary control character. It is the only record that a wrapped word's two halves are one word — the geometry alone says nothing. Kept as a soft hyphen through extraction; reflowing a paragraph now closes the halves and trims the trailing space the broken line carries at the line end, where it means nothing.* `Entwicklungsstelle` *reads correctly. The stream-adjacency attempt described below really was reverted as described; this was a different, correct signal found afterward.*

***A second real document (a complex-analysis sheet) surfaced two bugs worse than anything above, both now fixed, verified by converting it and diffing the output against a hand-written reference note:***

- ***Every word of German prose was silently missing from the converted note.*** *The extraction filter's signal for pdfium's synthetic layout characters was an empty* `font_name()`*. That held for the first document this pipeline was tested against, but is producer-dependent: this PDF's real body-text font also reports an empty name through pdfium, for reasons that have nothing to do with being synthetic filler. Re-keyed on font size instead — pdfium's actual filler is consistently \~1.0pt in both documents seen, and no real glyph, not even a subscript, is ever set that small.*
- ***Ordinary prose was getting torn apart mid-word with no maths or line break anywhere near it*** *(*`wird jeweils` *→* `wirdj eweils`*). A generated space's own* `x` *coordinate landed **inside** the following letter's advance box — sorting a row by raw* `x`*, which every fix up to this point had assumed was reliable, is exactly wrong when one character's own geometry lies. A row is now ordered by each character's position in the page's own extraction stream instead, which pdfium never gets wrong regardless of what an individual glyph's coordinate says.* `x` *is unchanged for everything else — gaps, script detection, region bounds.*

*Four smaller gaps that document also exposed, diagnosed but not attempted — detail and reasoning in* `TODO.md`*'s P4-2b: **fractions** (same root cause as the matrix/vector limitation — a numerator and denominator are separate physical lines with the bar drawn as an invisible-to-text-layer graphics path — but far more disruptive in a fraction-heavy sheet),* `∮` *(pdfium hands back an ASCII placeholder instead of a real Unicode value; a blind family-scoped guess was deliberately not added, since CMEX overloads ASCII codepoints per sub-font and a wrong guess would silently corrupt some other symbol elsewhere), **an enumeration-label boundary artifact** (*`(a$) C$`*), and* `ß` ***decoding to*** `ÿ`*, confirmed to be pdfium's own decoding of this specific font and not fixable from here.*

### P4-2e — Pipeline completion criteria (2026-08-13) — **S**, docs only ✅ **the pipeline is frozen**

**This subsystem is the only one on the roadmap with no natural end.** There is always another real document with another 2D-layout bug, and the two weeks after P4-2 was declared done proved it: \~120 commits, none of them wrong individually, none of them bounded collectively. A boundary has to be written as a rule, because "P4-2 is done" plainly was not one.

**Ruled fractions was the last 2D shape.** The freeze takes effect on its completion — a rule with a carve-out for work already underway is still a real rule, provided the carve-out is named and finite, and abandoning a half-built feature costs more than finishing it. It landed across `c72a24e`…`851bfff` (Blatt11 5 → 10 fractions, Blatt10 2 → 3, no sheet's count reduced; results and the constants that shipped are in `specs/pdf-ruled-fraction-reconstruction-design.md` §Implementation notes), **so the freeze is now in force:**

- **The corpus is frozen** at the documents already in it. It is the regression suite. Adding a document is a deliberate decision, not a reflex.

- **The bar is M4's own DoD — "faster than transcribing by hand" — not "correct."** A converted sheet needing three manual fixes still saved forty minutes. Correctness past that bar is not what this feature is for.

- **A new bug earns work only if it is whole-document** (prose loss, mid-word tearing — the P4-2b class, where output is silently wrong rather than visibly incomplete) **or recurs across two or more corpus documents.** Single-document, single-instance cosmetic bugs are recorded in `TODO.md` and left. *This is the load-bearing rule — the one that would have ended most of the last fortnight, and the one that will feel wrong to apply in the moment.*

- **2D-layout reconstruction is closed.** Matrices, `\cases`, stacked fractions, operator limits, tables and ruled fractions are the complete set. No new shapes. Anything outside it renders as glyph-order text, and `throwOnError: false` on both maths nodes contains the failure to that one equation.

- **Re-entry condition:** the pipeline reopens when *real coursework use* produces a document that fails the by-hand bar. Not before, and not from a diagnostic sweep.

- **DoD:** the rules above are recorded here and in `TODO.md`; the next 2D shape encountered is filed rather than fixed. ✅ — `TODO.md`'s P4-2e now carries a **"Filed, not fixed"** list, which is where a post-freeze bug goes instead of into a commit. An empty list is the feature working, not a gap.

### P4-3 — Exercise splitting, solution scaffold, and "add next task" — **M** ✅

The part the brief says "would save students hours every semester."

- Split the converted sheet on an exercise-heading pattern (`Aufgabe 3`, `Task 3`, `Exercise 3`, `Problem 3`, `3.`) into `## Task N` sections, each followed by a `### Solution` block.
- **"Add next task"** — a command/button that appends the next correctly-numbered Task/Solution pair, so space per task is never something to plan in advance (the brief's explicit ask).
- **Dependency:** P4-1. Independent of P4-2.
- **DoD:** A sheet with 5 exercises converts to 5 `## Task N` + `### Solution` pairs; "add next task" appends a correctly-numbered sixth. Where the heading pattern doesn't match, the note converts as one unsplit document — a miss degrades to plain conversion, never to dropped content.

*Done, then corrected. **The first cut ran splitting automatically on every Markdown import, and that was wrong** — turning a document into an exercise sheet asserts what the document* is*, and a lecture script or a paper would have been rewritten just as readily. It is now* **Split Into Tasks**, *a command in the slash menu and the File menu, run against the note in front of you; an import produces plain Markdown again, with a test in* `extract.rs` *pinning that. Deciding after conversion is also the better moment, because you can see what you actually got. Nothing is remembered — a remembered "always split" setting would be the same automatic behaviour wearing a checkbox.*

*The splitter accordingly lives in* `src/exercises.rs`*, not under* `pdf/`*: the pipeline no longer calls it, and a hand-written note is as valid an input as a converted sheet. It works on assembled Markdown rather than on* `Block`*s, which is also what lets it run on any note at all — blocks only ever exist one page, one region, at a time.*

***The one real decision: the splitting pattern is chosen once per document, never per block.*** *The corpus holds two shapes that invert each other. The Analysis sheets number exercises as top-level ordered items with indented sub-parts; Ue5/6/9 name theirs* `Beispiel N.M.` *and use top-level ordered items as the sub-parts — numbered continuously across exercises, and restarting partway. Splitting either one by the other's rule cuts inside every exercise on the sheet, so the keyword pattern claims the document outright when it matches at least twice (one match is a mention in prose, not a structure), and ordered items are consulted only when it does not.*

*Two things the real documents forced:*

- ***The sheet's own number is indistinguishable from an exercise.*** *Every Analysis sheet opens with* `11. Übungsblatt` *— a digit, a dot, and some text. Taking only the longest consecutive run starting at 1 excludes it, and does so without a list of title words ("Übungsblatt", "Sheet", "Assignment"), which would be a guess about the next document rather than a fact about this one.*
- ***An exercise opener can be indented.*** *Ue6's* `Beispiel 6.3.` *arrives eight spaces in and was silently missed while its four siblings split — the sheet quietly lost an exercise. A keyword opener is unambiguous at any indentation, so indentation is now allowed there (and only there; an indented* `1.` *genuinely is a sub-part). Its body is dedented with it, since under a* `## Task` *heading there is no enclosing list left and eight spaces would make the whole exercise a code block.*

*Bodies are otherwise copied verbatim, list markers included: a sub-part sits four spaces under its parent's marker, so stripping the marker would strand the children as an indented code block. The cost is a visible* `## Task 1` *sitting above a* `1.` *— cosmetic, and cheaper than the nesting damage the alternative risks.*

*Measured across all ten corpus sheets: every one splits completely, labels taken from the source, no gaps. "Add next task" is a slash command building nodes rather than Markdown, so the heading text is exactly what* `nextTaskLabel` *reads back next time; it counts from the last heading rather than the numerically highest, because what "the next one" means to a reader is positional.*

**Exit check for M4:** both import modes work and are chosen at import ✅; a real exercise sheet from a real course converts into a note that is genuinely faster to work in than transcribing by hand — **the remaining half of this check is the one thing code cannot supply.** Ten sheets convert correctly and split correctly, but the judgement "faster than by hand" is a use judgement, and §1's second closed question records that the maintainer is building rather than using. **M4 is reached on the evidence available; the dogfood slice is what confirms it.**

---

## Phase 5 — Versioned Workspaces / Git Automation (P5) ✅

**Milestone M5:** *My notes commit themselves. A paragraph I deleted yesterday is recoverable, and I never think about it.*

**This is not the cloud sync that was cut.** That cut was about the app building accounts, a server, and a sync protocol — it stands. This is P3-4's mandate ("make Git painless") taken from documentation to automation: the app drives the user's own Git, with the user's own remote. Local-first is untouched; nothing here is required to open a note.

**Why it sits right after P4:** it is the next tier of P0's work. P0 guaranteed the file on disk is never corrupt. This guarantees *yesterday's version still exists*. A commit is a recoverable backup, which makes this a data-safety feature that happens to look like convenience.

### The two modes, and why they get different defaults

Everything in this phase follows from one distinction:

|  | **Notes-only workspace** (lecture notes) | **Notes inside a code repo** (`notes/`, `docs/`) |
| --- | --- | --- |
| Whose history is it? | Yours alone | Shared; other people read the log |
| Commit noise | Harmless | A real cost |
| Auto-push | Yes | **Never** |
| Risk of touching unrelated work | None | High — your source lives there |

The code-repo case is the dangerous one, and the guardrails below exist because of it.

### P5-1 — Repo detection + per-workspace Git config — **S/M** ✅

- On opening a workspace, detect whether it is inside a Git repo and which mode applies: repo root ≈ workspace (**notes-only**) vs. workspace is a subtree of a repo containing source (**code repo**).
- **Shell out to** `git`**, don't link** `git2`**/**`gix`**.** Shelling out inherits the user's credential helpers, SSH agent, commit signing and `.gitconfig` for free — all of which are painful to reimplement and impossible to get exactly right. Requires `git` on `PATH`, a safe assumption for this audience.
- Config is **per-workspace and machine-local** (autocommit on/off, cadence, push policy). "Should this machine autocommit" is a fact about the machine, not about the notes, so it belongs beside `.workspace.json` — which P3-4 already gitignores — not in a synced file.
- **Opt-in.** Detecting a repo prompts once; it never starts committing on its own.
- **DoD:** Both modes are correctly identified on open; no Git command runs against any workspace that hasn't been explicitly opted in.

*Done. Detection is `git -C <workspace> rev-parse --show-toplevel`, classified purely by comparing the canonicalized result against the canonicalized workspace path — success and the two paths match is* `NotesOnly`*, success and they don't is* `CodeRepo`*, any failure (including "*`git`* not on* `PATH`*") is "not a repo," read off the exit code rather than a parsed error string so an unusual locale still detects correctly. Canonicalizing both sides matters on Windows specifically: git normalises its own* `--show-toplevel` *output to forward slashes regardless of platform, so a raw string comparison against the workspace path as given would mismatch on separator style alone. No mutating Git command exists yet — this phase's task is detection only.*

*The config lives directly on* `WorkspaceState`*, not a new file: `.workspace.json` was already the one workspace-folder file P3-4 gitignores, which is exactly "per-workspace but stays on this machine." Deliberately just two fields —* `prompted` *and* `auto_commit` *— rather than the cadence/push-policy fields P5-1's own prose lists, because those are P5-2's and P5-3's own named tasks; adding unread fields now would be scaffolding a feature ahead of the code that acts on it. `prompted` is tracked separately from `auto_commit` specifically so declining the prompt doesn't get asked again on every open, while still leaving the choice revisable — a Settings-panel toggle (visible only when the open workspace is a detected repo) reads and writes the same config the one-time banner does, through one shared `useGitConfig` hook, so there's a single persistence path for both surfaces.*

*Detection itself never blocks a workspace from opening — a missing* `git` *binary degrades to "no repo detected," not a failed open, matching how the rest of the app treats best-effort detection (P7-4's editor-command probe takes the same posture). Repo mode itself is never persisted: it's re-derived from the disk on every open rather than cached, since a workspace's Git status is a fact that can change between sessions (an existing folder later gets `git init`'d) and staleness there would be a silent correctness bug, not a convenience trade-off.*

### P5-2 — Batched auto-commit — **M** ✅

The core of the phase, and where every safety property lives.

- **Coarse cadence:** one commit per editing session, or after N minutes idle — deliberately far coarser than the 600 ms save debounce and the 2.5 s reindex debounce. Never per-save. Message summarizes what changed (`notes: update Analysis II Lecture 7, Lecture 8`).
- **Always pathspec-scoped.** `git add -- <note paths>` and `git commit -- <paths>`. Never `git add -A`; never a bare `git commit`, which would sweep in whatever the user has staged. In a code repo this is the difference between a useful feature and one that silently commits half-finished source.
- **Back off, never repair.** Skip the commit entirely if the repo is mid-rebase/merge/cherry-pick, on a detached HEAD, or already carries conflict markers. Report it quietly in the status bar. The app must never attempt to fix a repo state it didn't create.
- **Hooks: run them, and abort on failure.** A note commit in a code repo will trigger that project's `pre-commit`. Silently passing `--no-verify` in someone's repo is exactly the kind of decision that shouldn't be made on their behalf, so the default is to run hooks and abandon the auto-commit if one fails, surfacing why. A per-workspace "skip hooks for note commits" toggle exists for the case where the user knows their hooks don't cover `notes/` — opt-in, never assumed.
- **Dependency:** P5-1.
- **DoD:** An editing session produces exactly one commit touching only note paths. **Critically:** in a repo with staged source changes and unstaged source edits, both are still exactly as they were after an auto-commit runs — covered by a test, because this is the property whose violation would be unforgivable.

*Done. `checked_auto_commit` (`git.rs`) checks* `unsafe_repo_state` *first — resolving the git dir with one* `rev-parse --absolute-git-dir` *call, then reading detached-HEAD/merge/cherry-pick/rebase off it directly rather than one subprocess spawn per question. Only unresolved conflicts genuinely need git's own index parsing (*`ls-files -u`*). A conflicted merge sets* `MERGE_HEAD` *too, and that check runs first — reported as "a merge is in progress," the more specific and more actionable of the two true reasons; the conflicts-only test had to reach that state through a conflicting* `stash pop` *instead of a merge, precisely because a real merge conflict is never conflicts-without-a-marker.*

*Cadence lives on the frontend, not in* `git.rs`*:* `useGitAutoCommit` *resets a plain* `setTimeout` *(*`git.idleMinutes`*, default 10) on every new path added to a session-scoped* `gitPendingPaths` *list, and also flushes once from* `Layout`*'s close-requested handler so a session shorter than the idle window still commits before the app quits. A non-*`Committed` *outcome (skipped or a failed hook) leaves the batch pending rather than clearing it — the next trigger retries instead of the changes quietly vanishing from the batch.*

***The one unforgivable-failure test caught a real bug in itself.*** *The first version compared the whole-repo* `git diff --name-only` *listing before and after the auto-commit — wrong, because that listing is* **expected** *to shrink once the note's own change is committed. Fixed to scope both the staged and unstaged comparisons to the untouched source file specifically, which is the property the DoD actually asks for.*

### P5-3 — Push policy — **S** ✅

- **Notes-only workspace:** push after commit (configurable, on by default).
- **Code repo: never auto-push, at any setting.** Notes ride along with your next real push. Auto-pushing into a shared repo can trigger CI and put commits on a branch someone else is working from — outward-facing, hard to undo, and not worth the convenience.
- Handle no-remote, auth failure, and non-fast-forward rejection by surfacing the error; never retry blindly, never force.
- **Dependency:** P5-2.
- **DoD:** No sequence of UI actions causes a push from a code-repo workspace. A notes-only workspace pushes after commit and reports failures visibly rather than silently falling behind.

*Done.* `checked_push` *refuses* `RepoMode::CodeRepo` *unconditionally as a Rust-level guard — never called for a code repo today, but the guard exists so a future caller can't push into a shared repo by forgetting to check* `repoMode` *first. The frontend's only call site (*`useGitAutoCommit`*, after a successful commit) is itself gated on* `repoMode === 'notesOnly' && git.autoPush`*, so a code-repo push has two independent places to slip through, not one. No-remote, auth failure and non-fast-forward rejection are surfaced as distinct outcomes off* `git push`*'s stderr; none of the three retries or forces.*

### P5-4 — Fast-forward-only auto-pull — **M** ✅

The laptop→desktop case, and **the most dangerous task on the roadmap** — a bad merge writes `<<<<<<< HEAD` into a `.md`, which the editor will faithfully render as content.

- On workspace open (and optionally on an interval): fetch, then compare.
- **Local has no divergent commits → fast-forward silently.** The resulting burst of file changes is already handled: P0-5's watcher debounces it and P3-4 traced exactly this path for `git pull`.
- **Histories have diverged → stop.** Show a bar reusing the P0-5 conflict-bar pattern ("remote is ahead by 3, you're ahead by 1") and let the user resolve it in the terminal (P8) or their Git tool.
- **Never auto-merge, never auto-rebase, never write a conflict marker into a note.**
- A dirty buffer is never overwritten by a pull — this extends `CLAUDE.md`'s existing "a dirty buffer is never overwritten from disk" rule to cover the pull path, which is new.
- **Dependency:** P5-1. Independent of P5-2/P5-3.
- **DoD:** A laptop→desktop round trip fast-forwards with no prompt and no conflict. A deliberately diverged history produces a prompt and **zero** conflict markers in any `.md`. A dirty buffer survives a pull that would have changed its file.

*Done.* `checked_pull` *fetches, then* `git merge --ff-only @{u}` *does the actual fast-forward — the standard, safe way to move a branch ref without a real merge commit, and it refuses (rather than merging) both when history has genuinely diverged and when a local uncommitted change would be overwritten. Diverged is reported as* `Diverged { ahead, behind }` *with real counts from* `git rev-list --count`*, computed before any merge is attempted.*

***No new file-reload logic was needed****, which was the actual bet this task made: a fast-forward's resulting file burst is an ordinary external change from the app's point of view, and P0-5's watcher plus* `useNote`*'s existing dirty/clean handling already cover it exactly — confirmed rather than assumed, by tracing the same code path P3-4 already traced for a manual* `git pull`*.* `GitDivergedBar` *reuses* `ConflictBar`*'s* `.conflict-bar` *styling rather than inventing a second "you decide, we don't" bar look, and offers no action buttons beyond dismiss — resolving it is explicitly the terminal's (P8) or the user's own Git tool's job.*

### P5-5 — Repo creation for a notes-only workspace — **S** ✅

- A workspace that isn't a repo offers: `git init`, the `.gitignore` P3-4 already documents, and optionally a GitHub remote via `gh repo create`.
- **Private by default** — lecture notes must not become public by accident.
- If `gh` is absent, initialize locally and print the exact remote command to run. Never a hard dependency on `gh`.
- **DoD:** A plain notes folder becomes a private GitHub-backed repo in one action, or degrades to a working local repo with clear next steps when `gh` isn't installed.

*Done.* `checked_init_notes_repo` *runs* `git init`*, then writes the README-documented* `.gitignore` *— but never overwrites one that's already there, since the folder being turned into a repo isn't necessarily empty of prior intent.* `gh repo create --private` *is attempted only when the frontend asks for it and* `gh` *is actually on* `PATH`*; any failure past that point — absent, not logged in, offline — falls through to* `InitializedLocalOnly` *carrying the exact* `git remote add origin <url>` *command, surfaced in an alert rather than swallowed.* `gh` *is opt-in machinery, never a hard dependency, exactly as the DoD requires. The Settings-panel action sets* `repoMode` *to* `'notesOnly'` *directly on success instead of re-running detection — which reuses P5-1's existing one-time-prompt wiring in* `Layout` *unchanged, since* `git.prompted` *is still* `false` *for a workspace that didn't exist as a repo a moment ago.*

**Exit check for M5:** notes commit themselves in both modes ✅ — tested: staged and unstaged source changes survive an auto-commit byte-for-byte, and a code-repo workspace cannot push through any UI path. A fast-forward pull writes zero conflict markers; a diverged one stops and reports counts instead of guessing. **M5 reached (2026-08-17).**

---

## Phase 6 — STEM Authoring (P6) ✅

**Milestone M6 reached (2026-08-19):** *Writing maths, proofs and algorithms is faster in this app than in any general note app.* All seven tasks done: theorem/proof/algorithm blocks and collapsible sections (P6-1, P6-2), templates (P6-3), equation snippets (P6-4), the outline panel (P6-6), cross-references (P6-7), and scoped search (P6-5).

Cheap phase with a high hit rate: the callout node, the slash-command menu, and the markdown-serialisation pattern all already exist, so most of these are configuration and a serializer rather than new subsystems. **Every new node must carry its own** `addStorage().markdown.serialize/parse` — per `CLAUDE.md`, a node without one silently serialises as escaped plain text, which is data loss in slow motion.

### P6-1 — Proof blocks + collapsible sections — **M** ✅

- Theorem / Lemma / Corollary / Proof / Definition / Example blocks with optional numbering and a title.
- Collapsible sections (`<details>`-equivalent) — a brief item never built, and the natural way to hide a long proof.
- Build both on the existing `Callout` node's pattern rather than inventing a second block mechanism.
- **DoD:** Each block type inserts from `/`, round-trips through save→reload with its type and title intact, and prints correctly in the P3-2 PDF export. Collapse state is presentation-only — it never changes the `.md` content.

*Done. The decision this task was blocked on (§ above, closed 2026-08-18): collapse state is **presentation-only**.* `Details.tsx`*'s* `open` *attribute is gone from the node's schema entirely — expand/collapse is now plain* `useState` *in the React node view, never* `updateAttributes`*, so toggling a section can't dirty the buffer, trigger a save, or (under P5) produce an auto-commit for a click that changed nothing about the note's content. The cost side of that tradeoff is real and accepted: a note reopens with every section expanded, and a bare* `<details>` *(no* `open` *attribute) renders closed by default in GitHub. Content stays mounted in the DOM even while collapsed — hidden by a CSS rule, not conditionally rendered — specifically so P3-2's print pipeline can force it back to* `display: block` *at export time; the earlier conditional-render version would have silently dropped a collapsed section's content from every exported PDF. Reachable from* `/` *as "Collapsible Section," closing the other half of the original gap (built but unreachable).*

*The six proof/theorem types are new* `calloutType` *values on the existing* `Callout` *node — literally the DoD's "don't invent a second block mechanism," not just its spirit. Same* `> [!TYPE] Title` *blockquote-admonition syntax the note/tip/warning callouts already use, extended with an optional* `number` *attribute so a block can carry* `> [!THEOREM 3.2] Squeeze Theorem` *— P6-7 needs that number to resolve a bare "Theorem 3.2" in prose against a specific block, so it has to be real, round-tripped content rather than a title fragment. A* `Proof` *block appends a QED mark (∎) after its last child via CSS* `::after`*, never stored in the note. All six are reachable from* `/`*, get their own academic-palette CSS (both the dark editor theme and the* `@media print` *light variant), and* `.callout`*/*`.details-wrapper` *join the export pipeline's* `break-inside: avoid` *set alongside code blocks, tables and ink. Covered by four new round-trip tests in* `htmlFeatures.test.ts` *(numbered theorem, unnumbered/untitled proof, the remaining four types, and an assertion that* `<details open>` *never survives a serialize).*

### P6-2 — Algorithm blocks — **M** ✅

- A block with Complexity / Pseudocode / Implementation / References slots, per the brief.
- **Dependency:** P6-1 (same node pattern; build it second and reuse the machinery).
- **DoD:** Round-trips to readable Markdown that still makes sense opened in any other editor — the plain-`.md` principle applies here more than anywhere, since this is the most structured node in the app.

*Done. Reuses P6-1's mechanism literally rather than by analogy:* `algorithm` *is one more* `calloutType` *on the* `Callout` *node. The four slots are bold-labeled paragraphs inside the blockquote body, not a fixed sub-schema — a design choice forced by the DoD itself: a bespoke four-slot node type would be exactly the "most structured node in the app" the DoD warns is the highest-risk place to break the plain-*`.md`* principle, where reusing an already-portable admonition-plus-bold-text shape is legible in any Markdown renderer with zero new syntax. Reachable from* `/` *as "Algorithm Block," prefilled with all four slots (Pseudocode/Implementation as code blocks ready to fill in).*

*Two parser findings along the way, both in* `Callout.tsx`*, not new to this task but first exercised by it:*

- ***Real bug, fixed:*** *a blockquote line directly beneath the marker line, with no blank line between them, is the same Markdown paragraph as the marker (an ordinary soft line break) — and the parser's* `firstP.remove()` *deleted that entire paragraph, marker and body together, rather than just the marker. This is silent data loss on any hand-typed callout that doesn't leave a blank line after* `[!TYPE]`*, and Algorithm blocks make that pattern common by design (a label directly above its value). Fixed by walking* `firstP`*'s child nodes and removing only the characters belonging to the marker line —* `Text.deleteData` *splits the one node straddling the boundary — so whatever follows, including its own inline formatting, survives as the callout's first real body paragraph.*
- ***Narrower bug, filed rather than fixed:*** *a mark (confirmed with* `<strong>`*) that ends with no space or line break before more plain text, inside a* `Callout`*'s* `wrapBlock`*-driven serialization, round-trips with its closing delimiter misplaced —* `**Complexity**:X` *instead of* `**Complexity:**X`*. Reproduces from raw ProseMirror JSON with no markdown parsing involved, so it's in* `wrapBlock`*/*`renderContent`*'s interaction with prosemirror-markdown's own mark-boundary logic, not in the fix above. It does not reproduce through the actual* `/` *insertion path, since each slot's label and value are separate paragraphs there — only hand-typed Markdown with a mark glued directly onto trailing text triggers it. Recorded here rather than chased into a third-party library's internals for a narrow, avoidable trigger condition — the same posture P4-2e's frozen-pipeline bug list takes toward single-document, non-recurring defects.*

### P6-3 — Templates — **S/M** ✅

- A `templates/` folder in the workspace; "New from template" in the sidebar and File menu. Placeholder substitution — `{{date}}`, `{{title}}`, and any other `{{name}}` a template author writes, prompted for at creation time. Still no logic: no conditionals, no computed fields, no per-field types — a template stays a `.md` file with blanks, not a form.
- The exercise-sheet layout from P4-3 becomes the first real template; a lecture/proof template (`{{course}}`, `{{topic}}`, `{{theorem}}`) is a natural second and third once P6-1 lands.
- **DoD:** Creating a note from a template prompts for every `{{placeholder}}` the template uses and produces the filled content; templates are plain `.md` files, editable as normal notes, with no substitution engine beyond literal find-and-replace.

*Done.* `templates/` *joins* `node_modules`*/*`target`*/*`dist`*/*`build` *in* `is_excluded_dir` *— reusing the exact plumbing P7-3a built for exactly this ("this directory's* `.md` *files are not notes"), rather than growing a second exclusion mechanism. Reachable as* **New from Template** *in the sidebar and the File menu (*`Ctrl Shift T`*).*

*The dialog always asks for a note title first — needed for the filename regardless of what the template itself contains — then one field per unique* `{{name}}` *the template body actually uses (extracted by a plain regex, no logic beyond it),* `{{date}}` *pre-filled with today and everything else editable before creating. Substitution is literal* `String::split`*/*`join` *find-and-replace, per the DoD's explicit "no substitution engine beyond" it.* `create_note_from_template` *is a thin variant of* `create_note` *that writes the caller's already-filled content verbatim instead of synthesizing a* `# {title}` *heading — a template's own structure (the P4-3* `## Task N` */* `### Solution` *shape, in the shipped default) survives exactly as its author wrote it.*

*Seeding the one required starter template is opt-in, not automatic: an empty* `templates/` *folder shows a button ("Add the exercise-sheet starter template") rather than writing it on first open, matching P7-3's scaffold posture — nothing here writes into the workspace until the user asks. It never overwrites a template the user has since edited, the same "top up, don't replace" rule* `scaffold_project_notes_at` *established.*

### P6-4 — Equation snippets — **S** ✅

- `/gradient` → `\nabla f(x)`, and a table of the common ones. The `SlashCommands` extension already provides the menu, so this is a data table plus a maths-mode filter.
- **DoD:** Typing `/` inside a maths context offers snippets and inserts valid KaTeX; the list is one editable table, not code scattered per snippet.

*Done, and not the way the task description implies.* **The "maths context" turned out not to be reachable through** `SlashCommands` **at all.** `InlineMath` *and* `BlockMath`*'s edit surfaces are a plain* `<input>` *and* `<textarea>` *— real HTML form controls rendered inside a* `contentEditable={false}` *wrapper, deliberately outside ProseMirror's own document so LaTeX source editing doesn't fight the rest of the schema. `SlashCommands` is a TipTap* `Suggestion` *plugin that only ever sees ProseMirror transactions; it structurally cannot observe a keystroke typed into either box, "maths-mode filter" or not. The DoD's "/" trigger had to be reimplemented for this one context, not reused.*

`src/lib/mathSnippets.ts` *is the required "one editable table" — twenty entries, plain data, no code per snippet — plus three pure functions:* `activeSlashQuery` *(finds a* `/query` *ending at the cursor, same "nothing but the slash starts it, whitespace ends it" rule* `SlashCommands` *already uses),* `matchMathSnippets` *(prefix match on trigger or description), and* `applyMathSnippet` *(splices the snippet's LaTeX in and reports where the caret lands). All three are pure and unit-tested with no editor involved.* `useMathSnippetMenu` *(a hook, shared by both node views) wires that logic to a live input: it tracks the caret via* `selectionStart` *on every change/click/key-up, computes the active query and matches each render, and exposes keyboard handling (Arrow keys, Enter/Tab to select) that the input's own* `onKeyDown` *checks first — consumed there, the existing Enter-commits/Escape-cancels logic never fires for that keystroke.* `MathSnippetMenu` *is the one presentational dropdown both node views render, styled to match the editor-wide* `.slash-menu`*.*

*Covered by* `mathSnippets.test.ts` *(the three pure functions) and one RTL test in* `BlockMath.test.tsx` *driving the real textarea end-to-end: type* `/gradient`*, press Enter, assert the draft became* `\nabla f(x)`*, then Ctrl+Enter to commit and assert the node's LaTeX. Existing* `InlineMath`*/*`BlockMath` *round-trip and commit/cancel tests were re-run unchanged — none of the wiring touches serialization, and none of the existing tests type a* `/` *that could regress into a snippet match.*

### P6-6 — Outline / table-of-contents panel — **S** ✅

Long lecture notes are hard to move around in, and P6 is the phase that makes notes longer and more structured.

- Headings of the current note in the right rail, click to jump; highlight the heading currently in view.
- Share the rail with `BacklinksPanel` rather than adding a third permanent column.
- **Dependency:** none — the heading data is already in the ProseMirror document, so this needs no backend work at all.
- **DoD:** A long note's headings are listed and clickable; the list tracks the current scroll position; toggling the panel is on the P2-2 shortcut layer.

*Placement note: this was proposed alongside the P9 study features, but it is an **S**-effort navigation aid that serves any long note — parking it behind three phases would waste it. Moved here deliberately.*

**Postmortem, 2026-08-19 — the shipped version froze the app.** Reported by the user directly: opening an empty note, toggling the outline, and the whole app hangs — unclickable, nothing in the console. Root cause: the original design watched `.editor-pane` (the whole note-plus-panels container, including `OutlinePanel`'s own output) with a `MutationObserver`, on the theory that any DOM change there meant the headings needed re-scanning. That container also holds ProseMirror's live contentEditable root — and ProseMirror mutates its own DOM for entirely internal reasons unrelated to content, most visibly a trailing `<br>` it adds and removes to keep the last empty block clickable in some browsers. Confirmed by instrumenting the observer's callback and dumping the actual `MutationRecord`s it fired on: two records, `childList` add then remove, both targeting the ProseMirror root itself, repeating fast enough to reach a 30-call cap in well under a second with no bound in sight. Observing a live-editing surface with a generic subtree observer isn't safe *in general* — an editor is free to touch its own DOM for reasons that have nothing to do with document content, and nothing stops a reactive `setState` in the observer's callback from feeding back into whatever caused the editor to touch the DOM again.

*The fix drops DOM observation for the list entirely: headings are now parsed straight out of the note's own markdown string (already live in `Layout`'s `content` state on every keystroke — see the save path in* `CLAUDE.md`*) via a plain regex in* `lib/outlineHeadings.ts`*, stripping fenced code blocks first so a `# comment` inside a code sample doesn't count. The DOM is still read, but only in response to an actual user action — a click (find and scroll to the Nth heading) or a scroll event (find which heading is nearest the top) — never continuously, never observed. Caught this time by a real regression test, not a passing assertion: `p6-6-outline-panel.e2e.ts` drives the actual compiled app, toggles the panel on exactly the shape that froze it (a note holding only its auto-generated title heading), and asserts the WebView is still processing script afterward — a hung main thread simply never resolves that check, which is what originally caught this bug empirically before the fix, and would catch a regression the same way.*

*Reaching the toggle at all needed a second, smaller fix to the e2e harness itself: WebDriver automates the WebView, not the native menu bar, so `toggle-outline` (like `graph-view`/`toggle-terminal` before it) had no path any spec could reach — which is exactly how this shipped with zero coverage in the first place. `Layout.tsx` now exposes a narrow `window.__e2eRunCommand` hook — the same dispatcher a real menu click already uses, reachable from a test. It changes nothing about what the app does; it only makes an existing, already-guarded code path reachable from outside the native menu.*

*Done, prior to the freeze fix.* **The "rail" turned out not to be a literal rail either** *— same finding P6-4 made about "maths context": `BacklinksPanel` isn't a persistent right column today, it's a collapsible strip inline at the bottom of the note. "Share the rail rather than adding a third permanent column" is honored in spirit rather than letter:* `OutlinePanel` *sits directly above* `BacklinksPanel`*, in the same in-pane flow, and no new persistent screen column exists. It's rendered only when* **Toggle Outline** *(View menu,* `Ctrl Shift O`*) turns it on — lifted to* `Layout` *state exactly like* `toggle-terminal`*/*`graph-view`*, per the DoD's explicit "toggling is on the P2-2 shortcut layer" (`BacklinksPanel`'s own chevron is a local collapse, not that).*

*True to "no backend work": headings are read straight off ProseMirror's own rendered DOM — a* `MutationObserver` *on* `.editor-pane` *re-collects* `h1`*–*`h6` *elements on any content change, no lifted editor instance, no new node attributes. The current-scroll highlight walks the same headings' *`getBoundingClientRect()`* against* `.editor-scroll`*'s on every scroll event (the same ref* `useScrollRestoration` *already exposes to* `Layout`*, reused rather than duplicated). Only shown in WYSIWYG view — raw mode has no rendered headings to walk. Covered by four RTL tests:* `OutlinePanel.test.tsx` *drives heading collection, the empty state, click-to-scroll (asserts* `scrollIntoView`*), and the active-heading highlight via mocked* `getBoundingClientRect` *on a manually dispatched scroll event.*

### P6-7 — Cross-references — **S** ✅

Extends the numbering P6-1 gives Theorem/Lemma/Definition blocks into a reference, the same way P7-1 turned `file:line` text into a clickable code link: recognise `Theorem 3.2` (block-type keyword + its own number) in prose and resolve it to the numbered block, in this note or any other.

- `[[Theorem: name]]` continues to work as-is — it's an ordinary wiki-link pointed at a note; the new part is resolving a bare numeral reference to a specific *block*, not just a note.
- **Dependency:** P6-1 (block numbering is the referent).
- **DoD:** Typing `See Theorem 3.2` renders it clickable once such a block exists anywhere in the workspace, jumping to it on click; an unresolvable reference renders inert — matching P7-1's and P1-1's "prefer a miss" posture rather than guessing at the wrong block.

*Done, built as a close structural cousin of P7-1's* `CodeLink`*, deliberately — same decoration-not-node shape (a reference is ordinary prose, nothing new to serialize), same batched-and-cached resolution, same "unresolved renders inert" posture.* `src/lib/crossRefs.ts` *recognises the seven numbered* `calloutType` *keywords (Theorem/Lemma/Corollary/Proof/Definition/Example/Algorithm) plus a dotted number, case-insensitive on the keyword; a bare* `[[Theorem: name]]` *wiki-link needs no special-casing to stay untouched — the keyword there is followed by* `:`*, not a digit, so the pattern never matches it.*

**Resolution is workspace-wide, not per-note**, which is the one place this couldn't just copy P7-1: a code link resolves against the filesystem, but a numbered block has no index of its own anywhere. Rather than build one, `resolve_cross_refs` (`commands/crossref.rs`) reuses the FTS index P0 already built for search: a numbered callout's own serialized marker (`> [!THEOREM 3.2]`) is matched as a literal `LIKE` substring against `notes_fts`'s stored body, not an FTS5 `MATCH` query — deliberately, since the tokenizer would mangle a marker built from brackets and punctuation. `db::notes::marker_like_pattern` escapes `%`/`_`/the escape character itself before building the pattern, the same `escape_like` helper `rename_path_prefix` already uses, so a number containing `_` (a real LIKE wildcard) matches literally rather than as a wildcard — covered by a test that would otherwise resolve to the wrong note.

**Jumping to the block, not just the note, needed one small gap closed in `Callout.tsx`:** its React node view never put `calloutType`/`number` on the rendered DOM at all — `renderHTML`'s schema-level attribute mapping exists but is bypassed entirely once a node view takes over rendering, which it always does while the editor is mounted. `CalloutView`'s `NodeViewWrapper` now carries `data-callout-type`/`data-callout-number`, which is what lets `CrossRef`'s click handler find the exact block: it calls `openTab` (a no-op if the note is already open, per `store/workspace.ts`), then polls for the matching `.callout[data-callout-type][data-callout-number']` across a bounded number of animation frames — necessary because the target note may still be mounting — and flashes a brief outline on it once found.

*Covered by* `crossRefs.test.ts` *(the pure recognizer),* `crossRef.test.ts` *(batched resolution, click-to-navigate, unresolved-stays-inert, a failed lookup fails closed, no decoration without a workspace, and — the wiki-link boundary — `[[Theorem: name]]` decorates nothing), and three backend tests covering a found marker, a genuinely absent one, and the LIKE-wildcard-escaping case specifically.*

### P6-5 — Search refinement — **S** ✅ *(closes M6)*

The brief asks search to cover "equations, code, handwritten notes, PDFs." Equations and code already work (FTS indexes the raw `.md`); PDFs arrive with P4-1; handwriting is cut (§4). What's actually missing is **scoping**.

- Filter results by folder and by tag; keep a short recent-searches list (a brief workspace-memory item).
- Extend the same syntax to `type:` (block type — theorem, definition, algorithm, once P6-1/P6-2 exist) and `task:open`/`task:done` (once P9-1's `note_tasks` table exists) — same filter mechanism, more keys, not a query language. This is the bounded version of "Dataview-lite," already rejected below (§4) for being open-ended; a fixed, small key list is not the same risk.
- **Dependency:** folder/tag filtering ships standalone; `type:` needs P6-1/P6-2, `task:` needs P9-1 — both are optional extensions, not blockers.
- **DoD:** Search can be narrowed to a folder or tag without leaving the keyboard; recent searches persist per workspace; `type:` and `task:` filter the same way once their underlying data exists.

*Done — folder, tag and* `type:` *all shipped;* `task:` *is the one named extension left out, exactly as the dependency line allows: P9-1's* `note_tasks` *table doesn't exist yet, so there is nothing for it to filter.* `src/lib/searchQuery.ts` *is the pure parser — a fixed* `folder:`*/*`tag:`*/*`type:` *key list, one space-free token per value, deliberately no quoting syntax that would start turning this into a query language. Search stays a single box: typed keys are stripped out of the query text and sent to the backend as separate parameters alongside whatever free text remains.*

**Fixing this correctly surfaced a real, pre-existing gap:** `search_notes` had never scoped to a workspace at all. This app's* `index.db` *is one shared file across every workspace ever opened (per the storage boundary in* `CLAUDE.md`*), so a search in workspace A could return a hit from workspace B — silently, since nothing ever exercised two workspaces in the same index during testing. A* `tag:` *or* `folder:` *filter would have inherited that same leak, so `search_notes` now always takes and filters by `workspace`, joining `notes_fts` against `notes` (which already carries it) — the fix a filter feature needed anyway, not a scope-creep detour.*

*The four filters compose freely (free text, folder, tag, type, any combination) via one dynamically-built SQL string per call rather than a single static query with* `? IS NULL OR …` *placeholders throughout — `rank` is only a meaningful* `ORDER BY` *when an FTS5* `MATCH` *clause is actually present, and a fixed query can't conditionally drop a* `JOIN`*.* `type:` *reuses the same* `LIKE`*-against-the-stored-body approach P6-7's cross-references introduced (matching a callout's own* `> [!TYPE` *marker prefix, wildcard-escaped), rather than a second search mechanism.*

*Recent searches persist through the same channel* `openTabs`*/*`expandedFolders` *already do —* `WorkspaceState`*'s* `recentSearches` *field, saved at the same checkpoints (workspace switch, app close), loaded on open. A search is recorded only when a result is actually opened, not on every keystroke — "recent searches" means queries that found something, not typing fragments.*

**Exit check for M6:** all seven P6 tasks done. **M6 reached (2026-08-19)**: proof/theorem and algorithm blocks, collapsible sections, templates, equation snippets, the outline panel, cross-references, and scoped search all ship. Writing maths, proofs and structured notes is faster in this app than in any general note app — the milestone's own claim — across every dimension the phase set out to cover.

---

## Phase 7 — IDE Integration (P7) ✅

**Milestone M7:** *Notes and code are one workflow. I never manually hunt for the file a note is talking about.*

The brief's second pillar — **"IDE integration instead of IDE replacement"** — and the thing that most distinguishes this from Obsidian. It was entirely absent from this roadmap before 2026-07-29. It sits after P4/P6 because it opens a genuinely new surface (launching external processes) rather than building on existing infra.

**Design constraint:** the note stays plain `.md`. A deep link is ordinary Markdown that degrades to readable text in any other editor — never a proprietary token.

### P7-1 — Code deep links — **M** ✅

- Recognise `src/main.cpp:58` (and `path/file.rs#L20-L30`) in note text and make it clickable; clicking opens the configured editor at that file and line.
- Resolve paths relative to the workspace root, or to a project root if the workspace is inside one.
- **Security:** this executes an external process using text taken from a note. The launcher must pass the path as an argument to a configured command, never through a shell, and must refuse paths that escape the workspace/project root. Do not build the naive version.
- **DoD:** Clicking a `file:line` reference opens the right file at the right line in the configured editor; an unresolvable path renders as inert text with a clear "not found" affordance, exactly like an unresolved wiki-link; a path containing shell metacharacters cannot cause command execution, and a test covers that.

*Done, with P7-4, per its own note. Design:* `specs/code-deep-links-design.md`*.*

***The security posture is three structural properties, not three checks****, because a check is something a later edit can forget:*

- ***No shell, ever.*** `std::process::Command` *with one* `.arg()` *per argument. A target containing* `; rm -rf ~` *is then an argument naming no file.*
- ***The template is tokenized before substitution, never after.*** *Splitting after substituting would reintroduce word-splitting one layer up — the same injection — so the tokenizer never sees a resolved path at all. The test that pins this is a path with spaces staying a single argument.*
- ***A target is refused unless every component is*** `Component::Normal`*, following* `assets.rs`*'s* `resolve_relative`*: refused **as written**, never normalised and then compared, because normalising is what opens a gap between the string that was checked and the string that runs.*

*Recognition is deliberately narrow — both a separator and a file extension are required. Without that,* `Analysis 2:` *in prose, a* `10:30` *timestamp and a bare* `README` *all become links, and a wrong link that launches an editor is worse than no link at all. Same judgement as the PDF pipeline's exercise patterns, same answer: prefer a miss.*

*Existence is answered by a batched, workspace-cached* `resolve_code_links` *rather than per link per render, and a **failed** lookup marks its targets unresolved — the feature fails inert, never open. The project-root half of the DoD is deferred: it needs P5-1's repo detection, so today the workspace root is the only root and a link outside it is inert rather than wrong.*

### P7-2 — "Open in IDE" on code blocks — **S** ✅

- A code block that carries a source path gets an "Open in IDE" action.
- **Dependency:** P7-1 (same launcher, same path resolution, same guardrails).
- **DoD:** The action appears only on blocks that actually have a resolvable path — never a dead button.

*Done. "Carries a source path" turned out to need a recognition rule of its own — a code block's content is source, not a reference to it, so P7-1's* `findCodeLinks` *can't just run over the whole block. The answer reuses it anyway: a new* `codeBlockSourcePath` *(*`lib/codeLinks.ts`*) checks whether the block's own first line, comment marker optionally stripped (*`//`*,* `#`*,* `--`*,* `;`*,* `%`*), is nothing but a path —* `// src/main.rs` *above a pasted function is already how this gets written by hand, so recognition needed no new syntax and the annotation stays a plain, portable comment line in any other viewer. A code block naming two paths, or naming one only in passing ("see src/main.rs for details"), matches nothing — same "prefer a miss" posture P7-1 took.*

*The action itself is a widget decoration, not a node attribute: nothing new is stored in the document, so there is nothing new to serialize and nothing that can drift from the text it was read from.* `CodeBlockOpenInIde` *(new extension) shares* `CodeLink`*'s workspace-scoped resolution cache and its* `resolve_code_links`*/*`open_in_editor` *backend commands outright — the same launcher, the same guardrails, per the DoD — rather than standing up a second copy of either.* `resolveMissing` *is now exported from* `CodeLink.ts` *for exactly this reuse. The button renders only once* `resolve_code_links` *confirms the path, never as a disabled placeholder, and a code block that already carries no such button prints its content the same as any other in the P3-2 PDF export (hidden in* `@media print`*, since the affordance is interactive-only).*

**Exit check for M7:** reached — P7-1, P7-3, P7-4 and now P7-2 are all done. A note naming code is one click from the file, in prose and in a pasted block alike.

### P7-3 — Project awareness & project notes — **S/M** ✅ *(smaller than it looks — see the scan note)*

- **Scan ignore list — S. Do this first; it is the whole unlock.** A workspace is just a folder scanned for `.md`, so opening a code repo as a workspace *already works* — except `is_excluded_dir` (`src-tauri/src/commands/notes.rs:113`) skips only `.ink` and dot-directories, so the scan walks `node_modules/` and `src-tauri/target/` and drowns. Exclude the standard build/dependency directories (`node_modules`, `target`, `dist`, `build`; `.git` is already covered by the dot rule).
- Open a code project as a workspace and surface its existing `README.md` / `docs/` / `notes/` directly, with no import step (the brief: "No importing").
- Optionally scaffold a `notes/` folder (Architecture / Meeting / Research / Todo) on request — **on request only**, never automatically, and never writing into source folders.
- **DoD:** Pointing the app at this repo lists the files in `docs/` and nothing from `node_modules/` or `target/`, and does so as fast as a notes-only workspace; scaffolding is opt-in and creates only inside `notes/`.

*Why this moved up (2026-08-13): it is the cheapest path to the maintainer becoming a **user** of the app, which §1's second closed question identifies as the missing input to the whole prioritization formula. This project's own* `docs/` *— 18 specs, a plans folder, this roadmap — is a real daily Markdown workflow currently being done in another editor. See §6.*

*Done, and the scan note was right — the ignore list was hours, not the **M** this was scheduled as. It excludes* `node_modules`*,* `target`*,* `dist` *and* `build` *by exact name (so a folder called* `distributed` *survives) and, while there, the* `.pdf`*/*`.assets` *sidecars that had been left showing in the tree beside the already-excluded* `.ink`*. On this repo that is 580* `.md` *files across 218 dependency directories no longer walked, against the 46 in* `docs/` *that are wanted.*

*The scaffold is a File-menu item behind a confirm naming the folder, and is deliberately unreachable from anywhere else: it is the only command in the app that can write into somebody's source repository, so "on request only" has to be a structural property rather than an intention. It never overwrites — a repo already keeping* `notes/Todo.md` *gets the missing three — and a test asserts a sibling* `src/` *is untouched byte for byte, because that is the property whose violation would end the feature.*

### P7-4 — Editor command setting — **S** ✅

- A configurable launch command template (VS Code, JetBrains, Neovim…) in the P2-1 settings panel, with sensible detection of what's installed.
- **Dependency:** P2-1. Land this **with** P7-1 — a hardcoded editor path would be an immediate rewrite.
- **DoD:** Switching the configured editor changes where deep links open, with no code change.

*Done. One template string with* `{file}` *and* `{line}` *placeholders, defaulting by probing* `PATH` *for* `code`*,* `idea`*,* `nvim` *and* `subl` *in that order. Detection runs **only when the template is empty**, so it fills in on a fresh install or a machine that gains an editor, and never overwrites something the user typed — silently replacing a chosen template on any machine that also has VS Code would make the setting feel broken.*

---

## Phase 8 — Embedded Terminal (P8) ✅

**Milestone M8 reached:** *I can run* `claude` *(or any CLI) against the note I'm looking at without leaving the app.*

The brief's actual AI ask is *"a terminal in which I can do* `claude` *and work with the opened* `.md` *file"* — which is a **terminal feature, not an AI feature**. It is roughly an order of magnitude cheaper than the in-app assistant (P10-1), ships no AI code, adds no API key handling, and works with any CLI tool. Crucially, **the hard part is already built**: P0-5's watcher means a file edited by an external process is already detected, reloaded when clean, and conflict-prompted when dirty. The terminal is a client of infrastructure that exists.

### P8-1 — Terminal pane — **M/L** ✅

- A terminal pane (PTY-backed) rooted at the workspace, with the active note's path readily available — an env var and a one-key insert.
- **Dependency:** P0-5 (external-change handling is what makes CLI edits safe). Benefits from P2-2's command dispatcher for the toggle shortcut.
- **DoD:** Running `claude` in the pane and having it edit the open note updates the editor through the existing watcher path, with no new reload logic and no conflict-handling special case. Closing the pane leaves no orphaned process.

*Done. `portable-pty` (ConPTY on Windows) spawns the configured shell (a new* `terminal_shell` *setting, detected on load exactly like P7-4's* `editor_command`*) rooted at the workspace;* `xterm.js` *renders its output, decoded from base64 chunks streamed over a Tauri event — the same binary-over-IPC shape* `read_ink`*/*`read_pdf_page` *already use, needed because a multi-byte character can split across two PTY reads and Tauri events are JSON. Toggling the pane (View menu,* `Ctrl+\``*) only flips CSS visibility; the shell keeps running underneath, which is what lets a long* `claude` *session survive switching back to editing. Only an explicit "Kill Terminal" click or the app window closing actually tears the process down — the window-close handler now calls* `terminal_close` *before* `confirm_close`*, so quitting can't leave an orphan. The active note's path is frozen into* `NULL_NOTES_ACTIVE_NOTE` *at spawn time (a running process's environment can't be rewritten from outside); the header button, labeled with the current note's filename, covers the live case by typing the path at the cursor on demand.*

*The one real bug, found during manual QA: the insert-path button did nothing, silently. Root cause was a startup race —* `terminal_open` *spawns a real shell process and wasn't awaited before either write path (typed input or the insert button) could fire; a human's reaction time comfortably outlasts the spawn, so typing worked, but a click right after opening the pane could race ahead of it and hit "no terminal session is open" with no* `.catch` *anywhere to surface it. Both write paths now chain onto the* `terminal_open` *promise. Confirmed by reverting the fix via* `git stash`*, watching a new regression test fail against the pre-fix code, then restoring it and watching the same test pass.*

*Verifying the "no new reload logic" half of the DoD needed no code — a file edited from inside the pane is an ordinary filesystem write from the app's point of view, and P0-5's watcher already reloads a clean buffer or raises the conflict bar on a dirty one, confirmed in the same manual QA pass. Design:* `docs/specs/terminal-pane-design.md`*.*

**Exit check for M8:** the pane spawns rooted at the workspace, the env var and insert button both work, hide/show preserves a running session, and killing the terminal or closing the app leaves no orphaned shell process — all confirmed by hand, since none of it is realistically unit-testable in this environment (no native PTY in CI, no canvas/ResizeObserver for `xterm.js` in jsdom).

---

## Phase 9 — Study & Revision (P9) ✅

**Milestone M9 reached (2026-08-20):** *At exam time the app is where I revise, not just where my notes happen to live.*

The one phase not derived from `notes/Plan.md`. Everything before it is capture; this is retrieval. Ordered cheapest-first, because P9-1 is small enough to ship in a sitting and P9-3 needs a decision made before any code.

**Architectural rule for this whole phase:** study state is **data**, not index. Principle #1 says deleting `index.db` loses nothing — so nothing here may keep its only copy in SQLite. The established pattern applies exactly: source of truth in the `.md`, a derived table in `index.db` rebuilt by the same reindex path that already carries `note_tags` and `note_links`.

### P9-1 — Workspace-wide task view — **S/M** ✅

Coursework tasks live scattered across notes (`- [ ] finish exercise 3`) with no way to see them together.

- Extract `- [ ]` / `- [x]` into a `note_tasks` table (note path, text, done, position) — a direct mirror of `note_tags`, built in the existing `reindex_note` path, so it inherits the P0-3 debounce and the P0-5 watcher for free.
- A view listing open tasks grouped by note/folder; click jumps to the task in its note; ticking from the view writes through the normal save path.
- **Dependency:** none. Best value-per-effort in the phase — start here.
- **DoD:** Every unchecked task in the workspace appears in one place within one reindex cycle of being typed; ticking it from the view updates the `.md`; deleting `index.db` and reopening rebuilds the list identically.

*Done: `note_tasks (note_path, text, done, position)` mirrors `note_tags` exactly, including the three path-rewrite/removal call sites (`rename_path_prefix`, `remove_notes_under`, `update_path`) and the two forget-a-note call sites (`forget_note`, `delete_note`). `extract_tasks` (`commands/notes.rs`) is line-based rather than `extract_tags`'s strip-fences-then-regex — removing fenced code first would renumber the very lines `position` identifies, so it tracks "inside a fence" as a running flag instead, skipping matches there without shifting anything. The workspace-wide* `Tasks` *view (*`TaskView.tsx`*,* `Ctrl Shift K` */ View > Tasks) groups open tasks by note, mirroring* `GraphView`*'s modal-overlay shape; clicking a task or its note title opens that note exactly like* `SearchModal`*'s result click does. Ticking a task's checkbox calls a new* `toggle_task` *command that flips the* `- [ ]`*/*`- [x]` *line at the stored* `position` *and reindexes — written straight to disk via the same atomic-write path as every other note mutation, so no new conflict-handling was needed: the existing P0-5 watcher already treats this write like any external change, reloading a clean open buffer or conflict-prompting a dirty one for free. Covered by 16 new Rust tests (extraction, toggling, the three path-rewrite paths) and a two-part e2e spec (*`p9-1-task-view.e2e.ts`*) driving the real compiled app — list/group/tick/disk-flip, and click-to-open-a-different-note.*

### P9-2 — Formula sheet generation — **M** ✅

Many exams allow one A4 formula sheet. Building it by hand is hours of copy-paste from a semester of notes.

- Collect every block-math node across a chosen scope (folder, tag, or workspace) into a **generated note** — plain `.md`, editable afterwards like any other note, printable through P3-2's existing PDF export.
- Deduplicate identical formulas; optionally caption each with the note and heading it came from.
- Generate on demand into a real file. **No live-updating magic file** — a note that rewrites itself behind your back is exactly the kind of thing the plain-`.md` principle exists to prevent.
- **Dependency:** P3-2 (export path). Benefits from P6-1 if theorem blocks exist by then, but doesn't need them.
- **DoD:** Pointing it at a course folder produces one note containing that course's block math, deduplicated, in source order; it exports to a clean printable PDF; editing the result afterwards is ordinary note editing with no regeneration surprises.

*Done: scope is a single input reusing P6-5's `folder:`/`tag:` syntax, blank for the whole workspace — no dedicated picker UI.* `notes_in_scope` *(*`db/notes.rs`*) mirrors* `search_notes`*'s folder/tag SQL minus the FTS match and result cap, ordered by path for a stable source order.* `extract_formulas` *(*`commands/notes.rs`*) is line-based like* `extract_tasks`*, reading each scoped note's current file content directly off disk (not the FTS index, which can lag an open buffer) and recognising the same math forms* `BlockMath.tsx` *itself reads — a level-1 heading is deliberately excluded from "nearest heading," since it's the note's own title and the sheet already renders that as the* `##` *group. Formulas dedupe scope-wide by trimmed latex, grouped consecutively into* `## Note` */* `### Heading` *sections. Generation reuses the existing collision-refusing note-creation path, so regenerating over an existing sheet fails loudly rather than overwriting. e2e testing against the shared fixture workspace surfaced a real gap — a stale* `notes` *row whose file had since been deleted failed the whole generation — fixed by skipping an unreadable note rather than propagating the read error, the same posture* `reindex_from_disk` *already takes. Covered by 14 new Rust tests and* `p9-2-formula-sheet.e2e.ts`*.*

### P9-3 — Spaced repetition: **decision fork first** — **decision, then L** ✅

The highest-value study feature and the one with a real architectural catch, so **do not start coding until the storage question is settled.** Review scheduling is data that cannot be rebuilt from the notes, so `index.db` is not an option (principle #1). Three candidates:

- **Option A — inline state in the note (recommended).** Card state as an HTML comment beside each card: `<!-- sr due=2026-08-12 ease=2.5 interval=6 -->`. State is glued to the card, so it survives note renames, folder moves and Git sync with no key-tracking at all — and renames/moves are precisely where this app is known to be weakest (risk #6: note `id` is non-stable, `path` is the real key). Costs: every review writes a note file, and reviews churn Git history.
- **Option B — sidecar file in the workspace.** A `.review.json` synced alongside the notes. Notes stay pristine and reviews never touch them. Cost: cards must be keyed by note path plus card identity, which reintroduces exactly the stable-identity problem the app has so far avoided by never needing one. Editing a card's text or moving its note can orphan its schedule silently.
- **Option C — frontmatter.** Rejected on inspection: cards are per-*card*, not per-note, so a note with twelve cards needs a keyed list in its header — all of Option B's identity problem with none of Option A's locality.

**The sync argument, which is decisive.** The options above were first weighed on rename-survival, but P5 makes a second consequence concrete: **review schedules will be committed and pushed automatically**, so the storage format is also a merge format.

- **Option A** merges as text. Review on two machines and Git reconciles line-by-line; a genuine conflict is human-readable, sitting next to the card it belongs to.
- **Option B** is a single JSON blob. Review on your laptop and your desktop the same day and Git sees one file rewritten on both sides — **a conflict no one can resolve by hand**, in a file whose whole purpose is to be invisible. That is a bad day waiting to happen, and P5-4's fast-forward-only rule doesn't save you: it correctly refuses to merge, so you're left resolving the blob manually anyway.
- `index.db` wouldn't sync at all — schedules would diverge silently per machine, which is the worst outcome of the four and the reason principle #1 forbids it regardless.

**Recommendation: Option A**, on three independent grounds. It survives renames and moves with no key tracking, in an app whose note `id` is deliberately non-stable (risk #6). It merges as text under P5's automation. And it keeps the `.md` genuinely self-contained, which is principle #1 applied to a new kind of state. The one real cost — every review writes a note file — is affordable precisely because P0 was done properly: writes are atomic, debounced and conflict-aware, and reviews happen tens of times a day, not per keystroke.

Then, once decided:

- Card syntax over existing notes — cloze deletion for hiding part of a definition, and a `Question :: Answer` form. **P6-1's theorem/proof blocks are natural cards for free** ("state this theorem" / "prove it"), which is the real argument for P6 preceding P9.
- SM-2 scheduling; a review session UI; a derived `review_cards` table in `index.db` for "what's due" queries, rebuildable from the notes.
- **Dependency:** the fork above; P6-1 for theorem-block cards; **this is the concrete trigger for the frontmatter decision** deferred in §5 — if Option A wins, frontmatter may never be needed at all.
- **DoD:** Cards are authored inside normal notes and remain readable as plain Markdown in any other editor; a review session schedules correctly across restarts; deleting `index.db` and reopening loses no scheduling state; moving or renaming a note does not orphan its cards.

*Done, per the recommendation above (Option A, unchallenged).* Cards are two plain-text forms, one per line like every other extractor here: `front :: back`, and a line carrying one or more `{{cloze}}` spans (all spans on a line reveal together as one card — no per-span sub-cards). A card's schedule lives on the line directly below it, `<!-- sr due=... ease=... interval=... reps=... -->`, written for the first time only on that card's first review — a card with no comment yet is implicitly new and due today. `extract_cards` (`commands/notes.rs`) is line-based and fence-skipping like `extract_tasks`/`extract_formulas`, and `review_cards` is a purely derived table wired into the same five call sites `note_tasks` already uses.

Before writing any of that, the design phase verified a real risk rather than assuming Option A's comment would just work: mounting a note containing an HTML comment in the real `coreExtensions` and reading back `getMarkdown()` showed the comment **silently vanishes** — `tiptap-markdown` renders markdown to an HTML string and ProseMirror's `DOMParser` then walks Element and Text nodes only, dropping Comment nodes with no error. Left alone, opening and saving a note in this app's own editor would have quietly erased its entire review history. Fixed with a new `SrState` node reusing `Callout.tsx`'s own `parse.updateDOM` hook to rewrite the comment into a real (invisible) element before ProseMirror's parser ever sees it — confirmed with a throwaway round-trip test, since made permanent in `srState.test.ts`.

Scheduling is a pure `sm2::next_state(state, grade, today)` function (SM-2, four-button Again/Hard/Good/Easy grading, `today` passed in rather than read from the clock) — no I/O, cheap to test exhaustively. `ReviewSession` (`Ctrl Shift R`, or Home's Study section) fetches the due queue once but **re-fetches it after every grade** rather than caching it locally, per `TaskView`'s usual shortcut — a real bug e2e testing caught: grading a card inserts a comment line, which shifts the line position of any *later* due card in the same note, so a cached queue's stale position silently failed `grade_card`'s own is-this-still-a-card check and the session never advanced past it. Theorem/Proof-block auto-cards (mentioned above as the argument for sequencing P6 first) were deliberately left out — a user can already hand-author a `Question :: Answer` card from a theorem in seconds once card syntax exists, and auto-pairing adds real matching logic with no line in this task's own DoD.

### P9-4 — Workspace dashboard — **M** ✅

A single home screen instead of always opening to the last note — a capstone that pulls together threads P5 and P9 already built rather than adding new state of its own.

- **Continue** — the last few open notes, from `.workspace.json`'s existing tab/session state.
- **Recent** — recently edited notes, from the note list's existing mtime.
- **Tasks** — open task count, from P9-1's `note_tasks` table.
- **Study** — cards due today, from P9-3's derived `review_cards` table.
- **Git** — up-to-date / N unpushed / diverged, from P5's existing status calls.
- **Dependency:** P9-1, P9-3, P5-2/P5-3/P5-4. Sequence it last in P9 — it has nothing to show until the others exist.
- **DoD:** Opening a workspace with no tab restored (or an explicit "Home" command) shows all five sections, each read from existing data with no new derived state introduced for this task; clicking any item opens it exactly like its source view would.

*Done, ahead of P9-3.* Home reuses `Layout.tsx`'s existing `!activeTab` main-pane branch rather than a new overlay — `HomeView` renders in the same slot the old "select a note" empty-state text used to occupy, and a new `home` menu command (`Ctrl+H`) just calls `setActiveTab(null)`: no new view-state flag, and open tabs are never closed by it. Continue/Recent/Tasks/Git all read state or APIs another phase already computes (`openTabs`, `useNotesStore`'s `updatedAt`, `listOpenTasks`, and the P5 Git store fields `gitDiverged`/`gitPendingPaths`) — zero new derived state or backend commands, exactly as the DoD requires. P9-3 hadn't shipped yet at the time, so **Study shipped as a static disabled placeholder** ("Spaced repetition isn't set up yet"). Design: `docs/specs/workspace-dashboard-design.md`.

*Study section wired live, P9-3 (same day it shipped).* The placeholder is gone: `HomeView` now fetches `list_due_cards` the same way it already fetches open tasks, showing a due count and a **Start review** button that opens `ReviewSession` — still zero new derived state, since `review_cards` is P9-3's own table, not something this task added.

**Exit check for M9 — reached.** A real course folder yields a usable formula sheet (P9-2); its open tasks are visible in one place (P9-1); a revision session runs off the semester's own notes without any content having been re-entered by hand (P9-3, cards authored inline in existing notes); and Home surfaces all of it (P9-4).

---

## Phase 9.5 — Productization / Polish (P9.5)

**Milestone M9.5:** *The app looks and feels like a finished, considered product — not just a working one — even though it still has an audience of one.*

Added 2026-08-20 from a second review pass (`notes/Roadmap-Update2.md`). The pass initially read as public-distribution work — branding, "why should I care" onboarding — that §1 deprioritizes for a personal tool, and five of its nine ideas were challenged rather than scheduled on that basis (§4, struck through below). The maintainer overruled that the same day: wanting a polished, considered product regardless of audience size is exactly what §3's "enjoyment and learning are legitimate terms in the prioritization formula" already licenses — this roadmap doesn't get to substitute its own judgment about what's worth wanting. **Sequenced after P9, not before it:** P9.5 polishes existing surfaces, including P9's own dashboard and task/review views, so polishing them before they exist would be redoing the work.

### P9.5-1 — Brand identity — S ✅

- A real app icon (the one piece P1-5 left undone — window/taskbar/installer icon, not just the name), plus a short written identity note: what "Terminal Precision" communicates, how "terminal" and "academic notebook" aesthetics relate, and where each shows up.
- **Dependency:** none.

*Done: the mark is a broken null-ring (Ø) pierced by a drawn pencil at 45° — the pencil's own diagonal is the ring's slash, so "null" and "notes" live in one gesture rather than two symbols glued together. Several abstract-only attempts (ruled lines behind the ring, a hollow terminal-cursor block) were tried and rejected first; putting a literal writing instrument into the same stroke as the null symbol was what actually worked. Ring in signal green (`--accent`), pencil kept a neutral gray rather than forced into the accent — reads as a differently-made object, which is the point. Differentiates from sibling product null-ide's plain Ø (white on gray, no pencil) by silhouette, not just color. One accepted tradeoff: the same illustrated pencil is used at every size including the 16–32px taskbar/favicon range, where it reads softer than a flattened version would — a small-size-only flattened variant was built and rejected in favor of one consistent mark. Generated into the full Tauri icon set (`icons/32x32.png` … `icon.icns`/`icon.ico`) via `npx tauri icon`; unused Android/iOS scaffolding the generator also produces was deleted since this project doesn't target those platforms. Full writeup in `docs/brand-identity.md`; source SVGs in `logos/`.*
- **DoD:** the built app shows a custom icon everywhere Tauri currently shows its default one; a short identity note exists in `docs/` covering color, iconography language, and the terminal/notebook relationship, and at least one concrete design decision cites it.

### P9.5-2 — Design-system completeness pass — M ✅

- Extend "Terminal Precision" (already shipped, P2) into a documented, complete token set: a named typography scale (display/heading/body/metadata/code/math), a spacing scale, a surface catalogue (background/sidebar/editor/popover/modal/command-palette/context-menu/hover), and an interactive-state catalogue (default/hover/active/focused/disabled/loading/error/selected).
- **Dependency:** none — extends existing tokens rather than replacing them.
- **DoD:** a design-tokens reference exists (doc or a single source file) naming every category above with concrete values; spot-checking three arbitrary interactive elements (a button, an input, a tree row) finds all eight states defined, not just default/hover.

*Done: `docs/design-tokens.md` is the reference, naming all six typography categories, the color/spacing tokens P2 already shipped, a surface catalogue, and the interactive-state catalogue. `--font-mono` replaces 12 copies of the same monospace font-stack literal; three named elevation tokens (`--shadow-popover`/`--shadow-modal`/`--shadow-context-menu`) replace three shadow literals repeated across 10 selectors. `--text-heading-1/2/3`, `--text-body`, `--text-display` and `--text-metadata` are wired into real consumers (`.note-editor h1-h3`, `body`, `.workspace-picker-title`, `.workspace-name`) as `font` shorthand strings rather than left as documentation-only values. Spot-check elements (`.sidebar button`, `.settings-row-control input`, `.tree-row`) each got the four states they were missing — `:active`, `:focus-visible` via a shared `--focus-ring`, `.is-loading`, `.is-error` — plus `.is-selected` on the two that lacked a selected-state class. Two gaps found along the way are recorded rather than silently fixed: `.tree-row` has no `tabIndex`/keydown handling, so its new `:focus-visible` rule is currently unreachable by keyboard (flagged for P9.5-3/P9.5-4); `.block-handle-menu` uses a fourth, unnamed shadow value the token set doesn't cover (flagged for P9.5-3). One real bug fixed in passing: `.formula-sheet-prompt-input` referenced the undefined `--bg-primary`, silently rendering with a transparent background — corrected to `--bg-sunken` to match its sibling inputs.*

### P9.5-3 — UI hierarchy & consistency audit — M ✅

- Walk every major screen and judge it against "can I immediately tell what's important," not "does this feature work" — establish primary/secondary/tertiary hierarchy per screen.
- Combine with a formal consistency pass: record every inconsistency (button heights, icon styles, menu/dialog padding, tooltip delay, input focus treatment, panel borders, empty-state typography, shortcut notation, and how panel-open/tab-switch/dialog/drag-drop interactions feel against each other) in a table, then fix systematically.
- **Dependency:** P9.5-2 (needs the token set to fix against).
- **DoD:** each major screen has a one-line documented hierarchy (primary/secondary/tertiary); the consistency table's rows are each either fixed or explicitly deferred with a reason, not left silently unresolved.

*Done: `docs/ui-consistency-audit.md` covers 15 screens' one-line hierarchy plus a per-category consistency table across all nine named categories. Fixed: six unstyled default-rendered buttons (`FormulaSheetPrompt`/`TemplateDialog`) via a new shared `.dialog-action` class; a missing `.import-mode-cancel:hover`; a missing `box-shadow` on `.import-mode-dialog`; `.block-handle-menu`'s literal shadow/padding onto a new `--shadow-compact` token; a new `--text-empty-state` token unifying seven empty-state selectors' font-size; `.formula-sheet-prompt-input:focus`'s barely-visible border-color; a missing `title=` alongside existing `aria-label` on eight icon-only buttons; mismatched `<kbd>` padding between the sidebar hint and the shortcuts overlay; and the folder context menu's Delete action, the only destructive menu item in the app with no `.danger` color-marking (the pattern already existed on `.block-handle-menu-item.danger`, just wasn't applied there). One "unstyled button" flagged by the initial scan turned out to be a false positive on closer reading of the component tree (`ImportButton.tsx`'s buttons inherit `.sidebar button` via DOM ancestry) — verified rather than fixed. Several categories were reviewed and found to already be coherent, intentional patterns rather than drift (icon-size tiers, the two-tier border-radius scheme, `.import-mode-option`'s deliberate `.preferred` border emphasis) and are documented as such rather than "fixed." Genuinely out-of-scope findings were deferred with reasons to the tasks that actually own them: empty-state *wording* to P9.5-5, and the near-total absence of transitions/animations across every panel-open/tab-switch/dialog interaction to P9.5-4. Verified with `npm run typecheck` (clean), `npm test -- --run` (528/528 passing), and a dev-server screenshot.*

### P9.5-4 — Interaction & micro-interaction polish — M ✅

- Audit and align feedback across: opening/closing panels, tab transitions, menus, dialogs, drag/drop, tree expansion, selection, editor focus, search, saving, indexing, Git operations, PDF generation, workspace switching.
- Add restrained feedback where currently silent — a Git commit completing, a task being ticked, a note being created or copied — without gratuitous animation.
- **Dependency:** P9.5-2 (state catalogue defines what "consistent" means here).
- **DoD:** the interactions listed above are reviewed against a single documented feel (timing/easing), not left as a mix of nice/browser-default/custom/differently-custom; each gets at most one sentence in the design-tokens doc.

*Done: one curve (`--ease-standard: ease`) and two durations (`--duration-fast` 120ms, `--duration-base` 180ms — the latter kept from `.details-chevron`'s pre-existing value rather than replaced) now back every transition/animation in the app, guarded globally by `prefers-reduced-motion`. A shared base rule gives every button/row/tab/menu-item/link its hover-press-focus color transition in one place instead of the 50+ individual declarations the P9.5-3 audit found missing it. Floating surfaces (every modal, popover and menu) play one `surface-in` fade-and-settle on mount, no exit animation. Three concretely silent interactions named in the brief now give feedback: `useGitAutoCommit.ts`'s `'committed'` status, which used to sit in the tab bar indefinitely, now auto-reverts to idle after 4s; `TaskView.tsx`'s checkbox now shows checked-and-struck-through for 320ms before the row leaves the list instead of vanishing the instant the write resolves; a newly-created note's tab now gets one accent pulse, cleared via `onAnimationEnd` rather than a timer. The folder tree's expand chevron was changed from a hard swap between two different Lucide icon components to a single rotated icon, matching `.details-chevron`'s existing (and only reusable) rotate technique — a swap between two mounted/unmounted elements can't be animated by CSS at all. Each audited interaction gets its one-sentence entry in `docs/design-tokens.md`'s new Motion section, including the ones deliberately left instant (search-result filtering, save-status's icon swap, indexing — which has no user-facing state to animate at all) and the one named-but-nonexistent feature ("note being copied" doesn't exist; block duplication does, and already gives correct positional feedback via node selection — animating the new block itself would need a ProseMirror decoration plugin, left for a follow-up). Verified with `npm run typecheck` (clean), `npm test -- --run` (528/528 passing), and a dev-server screenshot.*

### P9.5-5 — Empty states — S

- Design a state for every major surface currently showing nothing or a bare message: search results, backlinks, open tasks, no Git repository detected, connections graph, terminal session. (Workspace/no-notes empty states already exist from P2-4.)
- Each communicates what the surface is and what to do next, not just "nothing here."
- **Dependency:** none.
- **DoD:** all six listed surfaces show a designed empty state; none is a bare "Nothing here" string.

### P9.5-6 — Error state polish — S

- Extend every user-facing error (save failure, Git push/pull failure, PDF import failure, conversion failure) to the same shape: what happened, confirmation that the underlying data is still safe (per `CLAUDE.md`'s "the file on disk is always safe" principle), and a concrete next action.
- P0-2's save-failure retry chip already has the mechanics; this is a copy and consistency pass over it and the others.
- **Dependency:** none.
- **DoD:** every error surface above follows the "what happened / what's still safe / what to do" shape; a save failure names the file and states the edit is preserved, not just "Save failed."

### P9.5-7 — Product onboarding pass — S/M

- Beyond P2-4's functional first-run (pick/create a workspace, create your first note, a `Ctrl+K`/`Ctrl+P` hint): the first 30 seconds should communicate what this is, why it's different from a plain Markdown editor or Notion, how Markdown fits, and what to do first.
- **Dependency:** P2-4 (extends it, doesn't replace it).
- **DoD:** a first-run experience states the app's differentiation in addition to the mechanical next action — verified by reading it cold, as if seeing the app for the first time.

### P9.5-8 — Editor feel re-pass — M

- Revisit cursor behaviour, selection, keyboard navigation, spacing, caret and selection appearance, and focus behaviour now that P6 has added many new node types (theorem/proof/algorithm blocks, equation snippets) since P2-3's original pass.
- **Dependency:** P6 (the node types this re-pass is checking against).
- **DoD:** each item above is checked against every P6 node type, not just the paragraph/heading/list types P2-3 covered; any regression found gets its own fix, not folded silently into this task.

**Exit check for M9.5:** the app has its own icon and a written identity; the design-token set is complete and interactive elements demonstrably use it; a hierarchy and consistency pass has been done and recorded; the six named empty states and the error-copy pattern are live; a first-time look at the app communicates what it is; and the editor feel holds up across every P6 block type.

---

## Phase 10 — Gated Stretch (P10) — explicitly gated

**Milestone M10:** *Only after M0–M9 are solid.* The v2 vision from `docs/specs/tech-stack-design.md`. **Do not let these influence P0–P9 design.** *(These were P4-1 and P4-2 before the 2026-07-29 re-scope, then P9-* briefly.)\*

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
| --- | --- | --- |
| **Automated OCR→LaTeX PDF pipeline (as spec'd)** | **Cut permanently** — superseded by P4, not revived | Broken skeleton, \~500 MB model + external binaries, degenerate bounding boxes, accuracy ceiling. P4 gets the same *outcome* (a sheet becomes editable Markdown) from the embedded text layer, so the OCR path has no remaining justification. The one thing OCR would still buy — scanned, image-only sheets — is handled by falling back to Pages mode (P4-2), which is the honest answer. |
| **Handwriting search (ink OCR)** | **Cut** | The brief asks search to cover handwritten notes. That needs handwriting recognition — a harder problem than the print OCR just cut, for a much smaller payoff. Ink is for working through a proof, not for archival retrieval; tag or title the note instead. |
| **Graphviz rendering** | **Challenged — not scheduled** | Mermaid already covers flowcharts, sequence, state and class diagrams. Graphviz means shipping a wasm build for the narrow gap (fine-grained graph layout). Revisit only if a real note actually needs DOT. |
| **TikZ export** | **Challenged — not scheduled** | Niche even for this audience, and only useful when handing work to LaTeX. P3-2's PDF export already covers submission. |
| **CodeMirror 6 as the editor** | **Superseded** | The brief named CodeMirror; the app is built on TipTap/ProseMirror, which is what makes WYSIWYG-with-inline-ink possible at all. Recorded so the brief's stack list isn't mistaken for a pending migration. |
| **Cloud sync** | **Cut (stays out of scope)** | Violates local-first principle; plain `.md` + Git/Syncthing already covers it. Invest in *making manual sync painless* (P3-4), not building sync. **Note (2026-07-29):** P5 automates the user's *own* Git against the user's *own* remote. That is this row's remedy taken further, not a reversal of it — the app still builds no accounts, no server, and no sync protocol, and still needs no network to open a note. |
| **Mobile / tablet app** | **Cut** | Desktop + stylus is the whole point; a second platform is a different product. |
| **Collaboration / multiplayer** | **Cut** | Single-user tool; enormous complexity for zero personal value. |
| **Segment-level eraser, hold-to-snap shape recognition** | **Defer indefinitely** | Ink is already a daily-usable subsystem; these are diminishing-returns polish. Only revisit if real use demands it. |
| **Distribution: installers, auto-update, code-signing, cross-platform** | **Out of scope now** | Personal tool. Revisit only if the audience decision changes to "ship to students." |
| **Stable note** `id` **scheme** | **Defer** | `path` is the working key; don't invest until something actually needs stable IDs (e.g. an external integration). |
| **Multi-window / split-pane editing** | **Defer — reconsider at P4** | Not blocking daily use. But the brief wants the workspace to remember split panes, and P4's "sheet on one side, solution on the other" is the first case with a concrete argument for it. Decide during P4 rather than in the abstract. |
| **Workspace remembers AI conversations** | **Cut** | A brief workspace-memory item that presumes the in-app assistant. With P8 (terminal), conversation history belongs to the CLI tool, not to this app. |
| **Note version history / snapshots** | **Challenged — do the cheap version or nothing** | Considered during the P9 planning pass. Building a snapshot store duplicates what Git already does, and P3-4 already assumes a Git-synced workspace. If this is ever wanted, it is a thin read-only wrapper over `git log`/`git show` for the current note — *not* a second storage system. Anything more is out of scope. |
| **Query blocks / Dataview-lite** | **Challenged — not scheduled** | Powerful, but committing to a query language is a rabbit hole with no natural end, and it would pull metadata design (frontmatter) forward speculatively. P6-5's tag/folder filters plus P9-1's task view cover the realistic 90%. Revisit only if a concrete query is wanted that those two genuinely cannot express. |
| **Lecture audio recording + timestamped notes** | **Cut** | A real student workflow, but a different product surface (capture device, audio storage, playback sync) attached to an app whose entire value is plain-text portability. An audio file is not a `.md`. |
| **Citations / BibTeX / reference manager** | **Cut** | Coursework cites rarely; this is a thesis-writing need, and Zotero already exists. |
| **Presentation / slides mode** | **Cut** | Niche, and P3-2's PDF export already covers sharing a note with a study group. |
| **Per-note "document map" (block-reference graph)** | **Challenged — not scheduled** | Redundant with two things that already cover the same underlying data: P3-3's connections graph (global, notes+tags+links) and P6-7's cross-references (in-note, click-through). A third, note-scoped visualization is a presentation choice, not a missing capability — revisit only if P6-7 in practice turns out to need a picture, not just a jump-to-block. |
| **Source-aware PDF notes** (click a converted exercise's "Source: Sheet.pdf, Page 4" back to the original PDF page) | **Challenged — blocked by the P4 freeze** | Genuinely useful, and distinct in kind from 2D-layout reconstruction (P4-2e's freeze target) — but recording page provenance still means touching the conversion path in `pdf/extract.rs`/`layout.rs`, and the freeze's re-entry condition is "real coursework use produces a document that fails the by-hand bar," not "a good idea arrives." No such document has. If the freeze ever lifts, this is a reasonable first thing to build — not a reason to lift it early. |
| **Unified command palette** (`Ctrl+Shift+P`, "Create theorem" / "Insert equation" / …) | **Challenged — not scheduled** | Every action it would list already has a path: the P2-2 native menu, the shortcut sheet, and P6's own `/` slash commands. A fuzzy-searchable palette earns its keep once the action count makes menu-hunting slow — revisit after P6 ships and the slash-command list has actually grown, not speculatively now. |
| ~~**Brand identity pass**~~ | ~~Challenged — not scheduled~~ → **Reversed 2026-08-20, done as P9.5-1** ✅ | Originally challenged as public-distribution work with no audience yet. The maintainer overruled that the same day — wanting this regardless of audience size is a legitimate preference (§3: "enjoyment and learning are legitimate terms in the prioritization formula"), not something this roadmap gets to veto. See Phase 9.5. |
| ~~**Formal design-system / UI-hierarchy audit**~~ | ~~Challenged — not scheduled~~ → **Reversed 2026-08-20, done as P9.5-2/P9.5-3** ✅ | Same reversal. See Phase 9.5. |
| ~~**Product onboarding**~~ | ~~Challenged — not scheduled~~ → **Reversed 2026-08-20, scheduled as P9.5-7** | Same reversal. See Phase 9.5. |
| ~~**Micro-interactions pass**~~ | ~~Challenged — not scheduled~~ → **Reversed 2026-08-20, done as P9.5-4** ✅ | Same reversal. See Phase 9.5. |
| ~~**General editor-polish re-pass**~~ | ~~Challenged — not scheduled~~ → **Reversed 2026-08-20, scheduled as P9.5-8** | Same reversal. See Phase 9.5. |

---

## 5. Cross-cutting concerns (apply across all phases)

- **Testing:** Keep the existing discipline — pure logic (Rust domain fns, TS `lib/`, `ink/`, `store/`) stays unit-tested; the debounce/save-state machine (P0-1/P0-2) **must** get tests since it guards data integrity. Tauri IPC orchestration hooks remain manually QA'd, per existing precedent.
- **Performance budget:** typing latency is sacred — keep DB work off the keystroke path (P0-3). Search and tree refresh should stay sub-100 ms at a few hundred notes.
- **Observability:** add lightweight logging behind the save/index/watch paths (P0) so a future "did it save?" question is answerable. No telemetry — local logs only.
- **Clippy/typecheck gates:** `cargo clippy -- -D warnings`, `npm run typecheck`, `npm run test` stay green on every commit (per `CLAUDE.md`). Note: there is no `npm run lint` script — don't reference one.
- **Markdown serialization (new, P6-critical):** every custom node must define `addStorage().markdown.serialize/parse`. A node without one serializes as escaped plain text — silent data loss. P6 adds more node types than any previous phase, so this is the phase where that rule gets tested.
- **YAML frontmatter — deferred, with a named trigger (2026-07-29).** The app has no frontmatter support; the title comes from the first heading. Adding it speculatively was considered and rejected: it is infrastructure with no current consumer, and building it "for later" is the premature abstraction the principles warn against. **The trigger is P9-3.** If spaced repetition needs per-note metadata, frontmatter lands then — and if P9-3 takes Option A (inline card state), it may never be needed at all. Do not add it for any other reason without a concrete consumer.
- **Derived-not-authoritative (new, P9-critical):** `index.db` is rebuildable — deleting it must lose nothing. P9 introduces the first state that is neither note content nor derivable from it (review schedules), so every P9 task carries the same test: *delete* `index.db`*, reopen, is anything gone?* If yes, the design is wrong.
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
                                  ├─> P6-7 cross-references
                                  └─> P9-3 spaced repetition (theorem blocks = cards)
P6-4 equation snippets (independent) ; P6-5 search refinement (independent; type:/task: extend it once P6-1/P6-2/P9-1 exist)
P6-6 outline panel (independent, no backend)
P7-1 deep links ──> P7-2 open-in-IDE ;  P7-4 lands *with* P7-1, not after
P7-3 project awareness (independent)
P5-1 repo detection ──┬─> P5-2 auto-commit ──> P5-3 push policy
                      ├─> P5-4 ff-only pull (independent of P5-2/3)
                      └─> P5-5 repo creation
P7-3 project awareness ──> P5-2's code-repo mode is most useful once this exists
[reindex_note path] ──> P9-1 task view      [P3-2 export] ──> P9-2 formula sheet
P9-3 storage fork ──> P9-3 implementation ──> (frontmatter decision resolves here)
P9-1, P9-3, P5-2/3/4 ──> P9-4 workspace dashboard (capstone, last in P9)
P10-* gated behind M9
```

### Execution order (revised 2026-08-13)

**Phase numbers are identity, not order.** They are referenced across commit messages and 18 design specs, so renumbering would churn all of it for no gain. The order below is what changes; the numbering does not.

| \# | Work | Size | Why here |
| --- | --- | --- | --- |
| 0 | Finish ruled fractions | — | In flight (`c72a24e`). The named carve-out in P4-2e. |
| 1 | **Freeze the pipeline** under P4-2e | S | Docs, not code. The next 2D shape is the rule's first real application. |
| 2 | Triage the three "Issues Discovered" in `TODO.md` | S | Reported defects on the daily-use path, owned by no phase, sitting above a 371-line plan. Reproduce first — all three are unverified. |
| 3 | **P4-3** → **M4** | M | Closes the milestone. Converts the PDF work from an open hunt into a shut phase. |
| 4 | **Dogfood slice:** P7-3's ignore list → P7-3 → P7-4 + P7-1 together → P8-1 | M/L | ✅ *Milestone reached: this project's own* `docs/` *lives in null-notes and gets edited there.* |
| 5 | ~~Re-derive P5, P6 and P9 from real use~~ | — | ✅❌ *Superseded 2026-08-17 (§1) — the wait never resolves because daily use isn't the mode the maintainer is in. Dropped rather than left open forever.* |
| 6 | ~~**P5**~~ → **P6 → P9**, in that order | — | ✅ *P5 done, M5 reached 2026-08-17.* ← Reverts to the pre-dogfood priority order (below), the roadmap's best estimate. P6 carries a scope caveat — see the note under its own TODO.md section — worth a glance before deep-planning it, but not a blocking wait. |

*Superseded order, now back in force for step 6: P4-1 → P4-2 → P4-3 → **M4** → P5-* → **M5** → P6-\* → **M6** → P7-1 + P7-4 → P7-2 → P7-3 → **M7** → P8-1 → **M8** → P9-\* → **M9** → P10.* *(P7 and P8 are already done, out of their slot in this list — the dogfood reordering pulled them forward and that part stands; only the P5/P6/P9 wait is reverted.)*

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

---

## 8. Polish backlog

Small, low-effort quality-of-life items collected from two review passes — 2026-08-18 (`notes/Roadmap-Update.md`) and 2026-08-20 (`notes/Roadmap-Update2.md`). None are phased — none gate anything, and folding them into a phase would make that phase's milestone about the wrong thing. Pull one out into a real task (with its own DoD) when it's actually being built; until then this is just the list, so a good suggestion doesn't evaporate between reviews.

**Editor**

- Find/replace within a note.
- Focus mode / zen mode — hide chrome, dim everything but the active block.
- Drag to reorder blocks; duplicate block; move block up/down; convert block type — all "block handle" affordances, natural extensions of the existing `BlockHandle` extension once one of them is actually built.

**Navigation**

- Recently closed tabs (reopen).
- `Ctrl+Tab` tab switching.
- Jump back / forward through navigation history — wiki-links, code deep links (P7-1), and cross-references (P6-7) all currently jump one-way with no way back except the tab itself.
- "Go to definition" for a wiki-link or code deep link under the cursor, without clicking through.

**Backlinks**

- Context snippets in the backlinks panel — the surrounding line or block, not just the linking note's title.

**Moved to Phase 9.5 (2026-08-20):** empty states (P9.5-5), save-failure and other error copy (P9.5-6), and the consistency audit (P9.5-3) were briefly listed here, then scheduled as real tasks once the maintainer chose to build the whole productization/polish pass rather than leave it unphased. See Phase 9.5.

**Deliberately left off this list:** multi-cursor editing. TipTap/ProseMirror's selection model has no clean multi-cursor primitive — it would be a real subsystem, not a backlog item, and belongs in its own phase if it ever turns out to matter.
