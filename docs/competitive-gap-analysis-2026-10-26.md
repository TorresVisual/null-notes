# Competitive Product & Feature Gap Analysis — Null Notes

Run date 2026-10-26, repo at `main` @ 117b0c2. Research depth: standard (one pass over primary docs/changelogs where reachable, search-snippet-level for the rest). Nothing here is filed as an issue yet.

## 1. Executive Summary

- **Competitive position.** Null Notes is ahead of every researched competitor on a narrow CS-coursework slice: text-layer PDF → editable LaTeX, in-note code execution, Git automation, and stylus ink *inside* a plain-`.md` note. It is behind on four things competitors treat as table stakes: scheduler quality (SM-2 only), document interop (single-note PDF only), handwriting recognition, and command discoverability.
- **Most consequential gaps are already filed.** The biggest *trust* gaps (#121 permanent delete, #129 uncommitted notes forgotten, #122 same-title collisions, #127 sidecar leaks) are bugs/gaps in the filed backlog, not discoveries. Finishing them matters more than any new feature below. The review-session gaps (#125, #126, #128, #67, #56, #63) are also filed.
- **Best differentiation opportunities.** (1) Offline handwriting → LaTeX on Windows, the one place a stylus-first Windows app could out-position Obsidian + plugins (OneNote is the Windows incumbent but ties math to a Microsoft 365 subscription). (2) FSRS scheduling inside plain-text card comments, which Obsidian only offers via third-party plugins that keep state outside the notes. (3) A Pandoc-backed export path for hand-in/exam-script workflows.
- **Recommended first steps.** Ship the filed trust fixes; add an action palette (small, reuses `ui/command.tsx`); verify whether single `.md` files opened from Explorer write back to the original; then decide the review-log storage question that gates both FSRS and #67.

## 2. Target Product Baseline

Sources: `PRODUCT.md`, `docs/ROADMAP.md`, `.claude/product-audit/FEATURES.md`, 45 open issues, spot-checks in `src/` and `src-tauri/src/` this run.

Constraints that filter every recommendation (from `docs/ROADMAP.md` §4, §7): one maintainer, Windows-primary, local-first/offline, `.md` stays the source of truth, no plugin API, no cloud/collab, PDF pipeline frozen, audio/citations/slides/query-language cut.

| Capability | Status | Evidence |
|---|---|---|
| WYSIWYG Markdown, math, callouts, footnotes, Mermaid, Excalidraw diagrams | Confirmed | `src/editor/extensions/` (about 50 files) |
| Inline ink, infinite canvas notes | Confirmed | `InkBlock*`, P13 |
| PDF import (text layer, no OCR), multi-sheet, exercise splitting | Confirmed, frozen | `src-tauri/src/pdf/` |
| Spaced repetition: SM-2 only, cloze/image/diagram/task cards, cram | Confirmed | `src-tauri/src/sm2.rs`; spec lists custom scheduling as out of scope |
| Code run (Py/C/C++), expected-output assertions, "Pin output" | Confirmed | `CodeBlockRun.ts` |
| Git auto-commit/pull/push, history panel, clone, Sync now | Confirmed | `git.rs`, `NoteHistoryPanel.tsx` |
| Quick switcher, search with `folder:`/`tag:`/`type:`, recent searches | Confirmed | `QuickSwitcher.tsx`, `SearchModal.tsx` |
| Saved searches | Not found in `src/` or `src-tauri/src/` | grep, no hits |
| Action/command palette (`Ctrl+Shift+P`) | Not found; only the note switcher and search use `ui/command.tsx` | grep |
| Note embeds / transclusion | Not found | grep, KB lists as Missing |
| Frontmatter / properties | Absent by decision | ROADMAP §5 |
| Export | Single-note PDF/print; no `.tex`/DOCX | `PrintDialog.tsx`; P18 unscoped |
| Light theme | Absent by decision | `docs/specs/visual-design-system-design.md` |
| Mobile | Partially built (P16); web app not started (P17) | ROADMAP |

## 3. Competitive Landscape

| Competitor | Type | Why relevant | Sources |
|---|---|---|---|
| Obsidian (+ community plugins) | Direct | Same files-on-disk model; the product Null Notes is positioned against. Plugin ecosystem fills many gaps natively absent here | [1.14.4 changelog](https://obsidian.md/changelog/2026-10-05-desktop-v1.14.4/), [Bases](https://obsidian.md/help/bases), [Web Clipper](https://obsidian.md/help/web-clipper/highlight) |
| Logseq (DB version) | Direct / cautionary | Outliner + flashcards; its 2026 move to SQLite-as-canonical is the opposite storage bet | [Logseq DB changelog](https://discuss.logseq.com/t/whats-new-with-logseq-db-may-16th-2026/35020) |
| Anki | Best-in-class (SRS) | Reference for scheduler quality | [Anki FAQ](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm) |
| RemNote | Adjacent (notes + SRS) | Notes and flashcards in one tool; PDF highlight → card | [RemNote PDF annotation](https://www.remnote.com/feature/annotate-pdf) |
| Goodnotes / Notability | Best-in-class (stylus) | Handwriting search, ink → LaTeX | [Goodnotes math](https://support.goodnotes.com/hc/en-us/articles/7443597657231-Convert-your-Handwritten-Math-to-Rendered-Math), [comparison](https://affine.pro/blog/goodnotes-vs-notability) |
| OneNote | Best-in-class on Windows stylus | The incumbent for Windows pen users | [Ink to Text/Math](https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/explore-the-ink-to-text-pen) |
| Mathpix Snip | Best-in-class (PDF/handwriting → LaTeX) | Closest to the PDF pipeline's goal, but cloud/OCR-based | [Mathpix App Store listing](https://apps.apple.com/us/app/mathpix-snip/id1445642260?uo=4) |
| Zettlr | Adjacent (academic Markdown) | Export and citation benchmark | [Zettlr features](https://www.zettlr.com/features) |

Not researched, deliberately: Notion (cloud-only, contradicts product constraints), Jupyter/Quarto (code execution comparison deferred; see §11).

## 4. Competitive Feature Matrix

| Capability | Null Notes | Obsidian | Logseq | Anki / RemNote | Goodnotes / OneNote | Practical difference / evidence |
|---|---|---|---|---|---|---|
| Plain `.md` as source of truth | Supported | Supported (not re-fetched) | Partially: DB version is canonical SQLite with a read-only Markdown mirror | Unknown | Unknown | Null Notes' strongest positioning; Logseq is moving away from it ([changelog](https://discuss.logseq.com/t/whats-new-with-logseq-db-may-16th-2026/35020)) |
| Stylus ink inside the note | Supported | Extension/integration (not verified this run) | Unknown | RemNote: freehand on PDFs only ([source](https://www.remnote.com/feature/annotate-pdf)) | Supported (native) | Null Notes combines ink with Markdown; ink apps lack Markdown |
| Handwriting → text / LaTeX | Not supported (gated, P15) | Unknown | Unknown | Unknown | Goodnotes: Supported, math runs on-device ([guide](https://support.goodnotes.com/hc/en-us/articles/10779112528399-A-guide-to-Goodnotes-AI)). OneNote: Supported on Windows, math requires Microsoft 365 ([support](https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/explore-the-ink-to-text-pen)) | Largest gap for a stylus-first app |
| Handwriting search | Not supported (cut) | Unknown | Unknown | Unknown | Goodnotes: Supported ([feedback reply](https://feedback.goodnotes.com/forums/950440-how-can-we-improve-goodnotes-for-windows?status_id=889086)); OneNote: Unknown | Follows from recognition |
| PDF → editable Markdown with LaTeX equations | Supported (text layer, frozen) | Not supported natively (unverified) | Unknown | Unknown | Mathpix: Supported via OCR ([listing](https://apps.apple.com/us/app/mathpix-snip/id1445642260?uo=4)) | Null Notes is offline and exact for typeset PDFs, Mathpix handles scans |
| Scheduler | Partially: SM-2 only | Extension/integration: several FSRS plugins ([Decks](https://community.obsidian.md/plugins/decks), [Retain](https://community.obsidian.md/plugins/retain)) | Unknown | Anki: FSRS + SM-2 since 23.10; RemNote: both (secondary source) | Goodnotes: cards exist, algorithm unknown | See gap A |
| Review stats / forecast | Not supported (#67) | Extension/integration (Mnemoloop dashboard) | Unknown | Anki: Unknown/unverified this run | Unknown | Tracked |
| Export beyond PDF (DOCX, `.tex`, multi-note) | Not supported | Unknown | Unknown | n/a | Mathpix: DOCX/LaTeX/Overleaf | Zettlr: "any Pandoc-supported (30+)" formats ([features](https://www.zettlr.com/features)) |
| Structured views over notes | Not supported (deliberate) | Supported: Bases core plugin, table/list/cards/kanban/map ([help](https://obsidian.md/help/bases)) | Unknown | n/a | n/a | Obsidian's heaviest 2025-26 investment; Null Notes cut it on purpose |
| Web capture | Not supported | Supported: Web Clipper with highlighter ([help](https://obsidian.md/help/web-clipper/highlight)) | Unknown | n/a | n/a | Separate browser-extension product |
| Open a loose `.md` outside a vault | Partially: Explorer entry copies a single file into a temp workspace; write-back to the original not verified | Supported as of 1.14.4 ([changelog](https://obsidian.md/changelog/2026-10-05-desktop-v1.14.4/)) | Unknown | n/a | n/a | See quick win Q2 |
| Action palette | Not supported (not found in code) | Supported (well known; not re-fetched) | Unknown | n/a | n/a | Explicitly deferred in ROADMAP §4 |
| Citations / Zotero | Not supported (cut) | Unknown | Unknown | n/a | n/a | Zettlr: BibTeX + Zotero ([features](https://www.zettlr.com/features)). Cut for good reason |
| Light/dark themes | Not supported (dark-only by decision) | Supported (themes) | Unknown | Unknown | Unknown | Deliberate deferral |

## 5. Critical Feature Gaps

No new "critical" gap beyond the filed backlog. The things that would hurt a user most today are already tracked: #129, #121, #122, #127. This section therefore lists only gaps new to the backlog that clear the bar.

### A. FSRS scheduler (alongside SM-2)

- **Current behavior:** SM-2 only. State is `<!-- sr due= ease= interval= reps= -->` in the note (`sm2.rs`). The original spec lists configurable scheduling as out of scope.
- **Competitor evidence:** Anki ships FSRS next to SM-2 since 23.10 and states it needs fewer reviews for the same retention and handles late reviews better ([Anki FAQ](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm)). Multiple Obsidian plugins offer it ([Decks](https://community.obsidian.md/plugins/decks), [Retain](https://community.obsidian.md/plugins/retain)). RemNote runs both (third-party source).
- **User problem:** A student with an exam in 8 weeks who skipped two weeks gets a pile of over-due, mis-spaced SM-2 cards. A desired-retention dial is also a more honest control than SM-2's ease floor.
- **Proposed behavior:** Per-workspace scheduler setting (SM-2 default, FSRS opt-in) plus a desired-retention value. Use FSRS default parameters first; skip the optimizer until a review log exists. Card state stays in the comment line (extended fields), so it still travels with the note.
- **Impact:** Medium to high for heavy reviewers. **Scope:** Large. **Confidence:** Medium.
- **Dependencies / risks:** (1) The optimizer and #67 forecast both need review history, which is neither note content nor rebuildable from it, so ROADMAP §1 requires a recorded storage decision first ("delete `index.db`, is anything gone?"). (2) Migrating existing SM-2 comments needs a conversion rule I haven't designed. (3) The "20-30% fewer reviews" figure appears only in secondary sources; Anki's own page makes the qualitative claim and says it is only roughly on par with SM-17 in preliminary tests. A forum report shows mixed per-user results.

### B. Handwriting → LaTeX/text (P15-1 evidence update)

- **Current behavior:** Ink is drawn, stored as SVG, not recognized. P15 is gated; handwriting search is cut.
- **Competitor evidence:** Goodnotes converts handwritten math to rendered math and LaTeX, on-device ([support](https://support.goodnotes.com/hc/en-us/articles/7443597657231-Convert-your-Handwritten-Math-to-Rendered-Math)). OneNote has Ink to Text, Ink to Math and a live Ink to Text pen on Windows 11 ([support](https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/explore-the-ink-to-text-pen)). Mathpix does handwriting → LaTeX in the cloud.
- **User problem:** A stylus user working a proof must retype every equation to make it searchable, flashcard-able or exportable.
- **Proposed behavior:** Lasso an ink region → "Convert to LaTeX" inserts a math block next to (not replacing) the ink. Keep the roadmap's gate, but use P15-1 to evaluate offline options.
- **Hypothesis, not verified:** Windows exposes a built-in handwriting recognizer through its ink APIs, which could meet the offline constraint without a model download. I did not research whether it recognizes math or is usable from Tauri. That is the first thing P15-1 should answer.
- **Impact:** Transformative for stylus users; **Scope:** Large; **Confidence:** Low-medium (feasibility unverified).
- **Risks:** Recognition quality (one Mathpix review calls handwriting "passably" accurate), and Windows-only behaviour clashing with the mobile plan.

### C. Document export beyond single-note PDF

- **Current behavior:** Print/PDF of one note. `.tex` export is P18, unscoped. #68 wants cross-sheet Solutions compilation.
- **Competitor evidence:** Zettlr exports to 30+ Pandoc formats ([features](https://www.zettlr.com/features)); Mathpix exports DOCX/LaTeX/Overleaf.
- **User problem:** Handing a write-up to a LaTeX-only course template, sharing with a Word-using group-project partner, or printing a whole course as one exam script all require leaving the app.
- **Proposed behavior:** (1) Multi-note "bundle" export (selected notes or a folder → one PDF, in tree order). (2) Optional Pandoc integration: if `pandoc` is on `PATH`, offer DOCX and `.tex`. No bundled binary.
- **Impact:** Medium; **Scope:** Medium (bundle), Large (Pandoc with custom nodes); **Confidence:** Medium.
- **Risks:** Spawning a process from note-derived input falls under `src-tauri/src/commands/CLAUDE.md`'s structural rules. Pandoc will not understand callouts, ink SVG sidecars, diagrams or cross-references without filters, so output fidelity is the real cost. Scope with #68 and P18 together.

## 6. Missing Workflows and Subsystems

- **Course-level views (saved searches).** Obsidian answers "show me everything for Course X, due this week" with Bases. Null Notes deliberately cut query blocks, but has no way to keep a filter. A saved `folder:`/`tag:`/`type:` search pinned in the sidebar would cover most of that without frontmatter or a query language. *Unresolved storage question:* `.workspace.json` is gitignored UI state, but a saved search is user content that should probably sync. Pick the column before the format (CLAUDE.md). Related: #107 (tag namespaces), #66 (task due dates), #63. **Scope:** Medium. **Confidence:** Medium.
- **Hand-in/exam-script pipeline.** Capture → import PDF sheet → solve → compile the solutions → export/print. Today the last two steps leave the app. Gap C plus #68.
- **Recognition pipeline for ink.** Ink ↔ search ↔ cards ↔ export are disconnected because ink has no text representation (gap B).

## 7. Small Improvements with High Impact

| Improvement | Current friction | Proposed change | Impact | Effort | Evidence |
|---|---|---|---|---|---|
| Q1. Action palette (`Ctrl+Shift+P`) | Format code, Sync now, Run, Export, Focus mode, Graph, Note history are reachable only via menus, toolbar or separate shortcuts. ROADMAP §4 deferred a palette until "the action count makes menu-hunting slow" | Reuse `src/components/ui/command.tsx` (already behind `QuickSwitcher`/`SearchModal`) to list existing actions | Medium | S/M | Obsidian's 1.14.x notes keep adding commands ([changelog](https://obsidian.md/changelog/2026-10-05-desktop-v1.14.4/)); in-repo grep shows no palette |
| Q2. Single-file open writes back | Explorer "Open in null-notes" on a file copies it into a temp workspace (`docs/plans/issue-25-explorer-shell-integration.md`). I did not verify whether edits reach the original | Verify; if not, either edit in place or warn clearly | Potentially high (data-loss class) | S | Obsidian 1.14.4 now opens loose `.md` files directly |
| Q3. Search typo tolerance / fuzzy in the switcher | Search is FTS5 with prefix matching; I found no fuzzy matching. Not verified for the quick switcher | Fuzzy match on titles/paths in `QuickSwitcher` | Low-medium | S | Obsidian 1.14.4 improved fuzzy matching and speed |
| Q4. Surface the existing review gaps first | Tracked: #125 (keyboard, undo), #126 (cap), #128 (card → note) | Do these before FSRS; they raise daily-use quality at lower cost | Medium | S each | Issues already filed |

## 8. Differentiating Opportunities

1. **Offline ink → LaTeX on Windows.** OneNote's math conversion needs Microsoft 365; Goodnotes' handwriting-to-text help page says Windows is unsupported (conflicting with a forum reply, so verify). Obsidian's stylus story is plugin-dependent. A local, plain-text-output converter would be distinctive *if* an offline recognizer is feasible.
2. **Review state that lives in your notes.** Retain's selling point is keeping scheduling data out of the notes ([listing](https://community.obsidian.md/plugins/retain)); Null Notes does the opposite on purpose, so cards are versioned, merged and portable with Git. FSRS on top of that storage model is something plugin-based competitors structurally can't match.
3. **Typeset-PDF fidelity.** Mathpix is OCR/cloud-based. The text-layer pipeline remains rare; protect it (frozen) rather than extend it.

Not recommended: AI flashcard generation or chat. Goodnotes and RemNote ship it, but the roadmap gates AI (P10-1) and no concrete study problem here needs it that the above doesn't solve locally.

## 9. Prioritized Backlog

| Priority | Recommendation | User value | Competitive value | Effort | Confidence | Rationale |
|---|---|---|---|---|---|---|
| P1 (filed) | Ship #129, #121, #122, #127 | High | Medium | S-M each | High | Data-trust gaps; competitors with sync/trash have these basics |
| Quick win | Q2 verify single-file write-back | High if broken | Medium | S | Medium | Possible data-loss path; cheap to check |
| Quick win | Q1 action palette | Medium | Medium | S/M | Medium | Existing component; resolves a documented deferral trigger |
| P2 | #125, #126, #128 (filed) | Medium | Low | S each | High | Raise review quality before changing the algorithm |
| P2 | Saved searches | Medium | Medium | M | Medium | Cheap answer to Bases without a query language |
| P3 | A. FSRS option | Medium-high | High | L | Medium | Gated by the review-log storage decision, pairs with #67 |
| P3 | C. Export bundle (+ Pandoc later) | Medium | Medium | M, then L | Medium | Combine with #68 and P18 scoping |
| P3 | B. P15-1 recognizer spike | High if feasible | Very high | L | Low-medium | Time-boxed feasibility check, not a build commitment |
| P4 | Note embeds (`![[Note#Heading]]`) | Medium | Medium | M-L | Low | Reuses wiki-link plumbing but adds non-portable syntax; the ROADMAP KB marked it low priority |
| P4 | Web capture / quick capture | Low-medium | Medium | M | Low | Obsidian's clipper is a separate extension product; consider only "paste URL → clean Markdown" |
| P4 | PDF text highlight → note/flashcard | Medium | Medium | L | Low | RemNote does this; blocked by the pipeline freeze and unknown Pages-mode text selection |
| P4 | Light theme | Low-medium | Low | L | Low | Deliberately deferred; revisit if the "real stranger" bar is enforced |

## 10. Suggested Development Sequence

1. Filed trust fixes: #129, #121, #122, #127. Nothing else should ship ahead of these.
2. Quick wins: Q2 (verify), Q1 (palette), then #125/#126/#128.
3. Record the review-log storage decision (ROADMAP §1) together with #67. This unblocks FSRS and forecast stats.
4. FSRS opt-in, default parameters, no optimizer. Add the optimizer only if the review log exists.
5. Saved searches (after deciding where they live).
6. P15-1 recognizer spike in parallel whenever there is stylus-heavy use to justify it; its answer decides whether P15-2/3 happen.
7. Export: scope bundle export with #68 and P18, then Pandoc.
8. P4 items only on concrete demand.

## 11. Limitations and Open Questions

- Depth was standard, not exhaustive. Several competitor cells are Unknown/unverified; I did not verify Logseq, Notion, Jupyter/Quarto, Anki's stats, or Obsidian's core export.
- Obsidian command palette, embeds and saved-search/bookmark behavior are from general knowledge, not fetched this run. Re-verify before citing.
- Goodnotes/Notability evidence is largely vendor or comparison-site content; the Goodnotes help page and forum reply disagree on Windows handwriting-to-text availability.
- RemNote scheduler/handwriting details are from third-party profiles and the feature navigation, not documentation.
- Code-level claims ("not found") rest on grep for obvious names, not a full read.
- Open question for the maintainer: is the "real-stranger bar" meant to include appearance options (light theme) and a loose-file open path?
- Open question: is the pen/stylus workflow on Windows the main driver for P15, or would an iPad/Android build (P16) be where ink matters most?
- No user research exists; value ratings are judgment, not data.

## 12. Sources

- Obsidian: [1.14.4 changelog](https://obsidian.md/changelog/2026-10-05-desktop-v1.14.4/), [1.14.3](https://obsidian.md/changelog/2026-09-29-desktop-v1.14.3/), [1.12.0 (CLI)](https://obsidian.md/changelog/2026-02-10-desktop-v1.12.0), [Bases](https://obsidian.md/help/bases), [Web Clipper highlighter](https://obsidian.md/help/web-clipper/highlight)
- Obsidian FSRS plugins: [Decks](https://community.obsidian.md/plugins/decks), [Retain](https://community.obsidian.md/plugins/retain), [Mnemoloop](https://community.obsidian.md/plugins/mnemoloop)
- Anki: [Which algorithm?](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm)
- RemNote: [PDF annotation](https://www.remnote.com/feature/annotate-pdf)
- Logseq: [What's new, May 16 2026](https://discuss.logseq.com/t/whats-new-with-logseq-db-may-16th-2026/35020)
- Goodnotes: [handwritten math](https://support.goodnotes.com/hc/en-us/articles/7443597657231-Convert-your-Handwritten-Math-to-Rendered-Math), [handwriting to text](https://support.goodnotes.com/hc/en-us/articles/7353695997199-Convert-handwriting-to-text-in-Goodnotes), [AI guide](https://support.goodnotes.com/hc/en-us/articles/10779112528399-A-guide-to-Goodnotes-AI), [Windows feedback forum](https://feedback.goodnotes.com/forums/950440-how-can-we-improve-goodnotes-for-windows?status_id=889086); comparison (competitor-authored): [affine.pro](https://affine.pro/blog/goodnotes-vs-notability)
- OneNote: [Ink to Text pen](https://support.microsoft.com/en-us/onenote/onenote-help-and-learning/explore-the-ink-to-text-pen), [Math Assistant](https://support.microsoft.com/en-us/topic/create-math-equations-using-ink-or-text-with-math-assistant-in-onenote-dc818fad-60e0-432d-8cae-b61f9febf874)
- Mathpix: [Snip App Store listing](https://apps.apple.com/us/app/mathpix-snip/id1445642260?uo=4)
- Zettlr: [features](https://www.zettlr.com/features)
- Internal: `PRODUCT.md`, `docs/ROADMAP.md` (§1, §4, §5, §7, P15, P18), `docs/specs/spaced-repetition-design.md`, `src-tauri/src/sm2.rs`, `docs/plans/issue-25-explorer-shell-integration.md`, `.claude/product-audit/`
