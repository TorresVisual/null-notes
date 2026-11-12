# Competitor audit: Obsidian

Audit date: 2026-10-31. Repository: `TorresVisual/null-notes` at `main` (e94c854). Competitor documentation: <https://obsidian.md/help/>. Earlier, narrower research on the same product is in [../../competitive-gap-analysis-2026-10-26.md](../../competitive-gap-analysis-2026-10-26.md); this audit does not repeat its non-Obsidian competitors.

Nothing here implements a feature. The only repository change is this directory. Fourteen GitHub issues were filed after the user approved the drafts (#149-#162, see "Issue status").

## Supporting artifacts

| File | Purpose |
|---|---|
| [feature-inventory.json](feature-inventory.json) | Source of truth: 211 features with status, evidence, gap, issue reference |
| [feature-inventory.md](feature-inventory.md) | Human view of the JSON, by category and subcategory |
| [documentation-coverage.md](documentation-coverage.md) | Crawl record: every URL, depth of reading, what was not covered |
| [implementation-gaps.md](implementation-gaps.md) | Missing and partial features by priority, with reasons for the ones not filed |
| [issue-log.md](issue-log.md) | Duplicate searches and disposition of every proposed issue |
| [issue-drafts/](issue-drafts/) | The 14 issue bodies (D01-D14) as filed |

The Markdown views are generated from the JSON, so counts agree by construction.

## Scope and method

1. **Product baseline.** Read `CLAUDE.md`, `PRODUCT.md`, `docs/ROADMAP.md` (§1, §4 cuts, §5, §7 out of scope, §8 polish), `.claude/product-audit/`, the three `CLAUDE.md` sub-guides, the `file-issue` and `product-audit` skills, and all 148 GitHub issues (open and closed, titles and labels; bodies where needed).
2. **Documentation crawl.** The Help site is an Obsidian Publish site. Its sitemap lists 179 pages; the Publish file index exposes each page's Markdown source, and all 179 were fetched with no failures. Details and reading depth are in [documentation-coverage.md](documentation-coverage.md).
3. **Inventory.** The pages were decomposed into 211 testable capabilities. The cut line is described below.
4. **Implementation audit.** Each capability was checked against the code (greps, reading the relevant files, one runtime experiment for frontmatter) and recorded with file evidence. Behaviour, not names, decided the status.
5. **Issues.** Every gap was matched against existing issues and the roadmap's cut/defer decisions. Gaps with an actionable, undecided, in-scope need became drafts.

Granularity: a feature is a capability with its own acceptance test (for example "exact phrase search", "foldable callouts", "pin a tab"). Closely related micro-interactions are grouped; areas that are external services, importers or developer surfaces are grouped as clusters (Bases, Importer apps, CLI, Web Clipper, Sync/Publish/Teams) rather than listed function by function.

## Application architecture (summary)

- Tauri 2 desktop shell (Windows primary), Rust backend (file I/O, SQLite FTS index, Git, PDF pipeline), React 19 + TypeScript frontend, TipTap 3 / ProseMirror WYSIWYG with per-node Markdown serialisers via `tiptap-markdown`.
- Storage contract: plain `.md` files plus name-keyed sidecar folders (`.ink`, `.pdf`, `.diagrams`, `.assets`) inside the workspace; `index.db`, `settings.json` and recent-workspaces list in the OS app-data dir and rebuildable. Notes are identified by path; wiki-links are keyed by title.
- Save path: debounced autosave -> `write_atomic`; reindex on a slower debounce; own-write echo suppression; a dirty buffer is never overwritten.
- Product position: a one-maintainer, local-first, offline tool for CS coursework. `docs/ROADMAP.md` §7 rules out cloud sync, collaboration, plugin API, public distribution, encryption and anything that makes the `.md` not the portable source of truth; §4 records cuts (audio, slides, citations, query blocks, handwriting search, per-note graph, multi-window).
- Differentiators to protect: text-layer PDF to LaTeX import (frozen), inline ink, Excalidraw diagrams, code execution, spaced repetition, Git automation.

## Documentation coverage

179 of 179 sitemap URLs inspected, 0 failed, 0 skipped. 75 pages (Editing and formatting, Linking, Files and folders, Getting started, User interface, Plugins) were digest-read (all headings, lists, tables, section openings). The other 104 (Bases, Import, Extending, Web Clipper, Sync, Publish, Teams, licensing, about, contributing) were read at heading level only, which is enough to classify them but not to audit fine detail. See the coverage file before relying on any claim about those areas.

## Feature inventory statistics

211 features in 15 categories.

| Status | Count |
|---|---|
| Implemented | 58 |
| Partially implemented | 37 |
| Missing | 80 |
| Not applicable (with rationale) | 28 |
| Unverified | 8 |

Per-category counts are in [feature-inventory.md](feature-inventory.md). Unverified entries (not counted as gaps, no issue filed): ED-004 Shift+Enter/line breaks, ED-019 nested callouts, ED-022 paste without formatting, LK-007 link from selection, FL-004 vault rename/remove, FL-006 symlinks, FL-021 backup guidance, ON-003 accessibility baseline.

## Confirmed gaps

Missing plus partial = 116 entries. Disposition:

| Disposition | Entries |
|---|---|
| New issue filed (14 issues, #149-#162) | 23 |
| Covered by an existing issue | 12 |
| Not filed, reason recorded | 81 |

The 81 unfiled entries break down roughly (by keyword on the recorded reason, so approximate) into 24 deliberate roadmap cuts or deferrals (audio, slides, query blocks, properties, multi-window, iframes, per-note graph), 15 third-party importers, 4 that depend on or duplicate another entry, 2 design differences (sidecar attachment location, ribbon) and 36 judged niche, marginal or too uncertain to file. Every one has its reason in [implementation-gaps.md](implementation-gaps.md).

### New issues filed

| Draft / issue | Title | Priority |
|---|---|---|
| D01 / #149 | Notes with YAML frontmatter are rewritten and corrupted when edited (`bug,medium`) | P1 |
| D02 / #150 | Search: exact phrases, OR, exclusion, grouping | P2 |
| D03 / #151 | Search shows at most 20 results, no sort order | P2 |
| D04 / #152 | Wiki-links: display text and heading anchors | P2 |
| D08 / #156 | Note context menu: duplicate, show in Explorer, copy path, move to... | P2 |
| D11 / #159 | Bookmarks: notes, headings, saved searches | P2 |
| D05 / #153 | Embed a note or heading (transclusion) | P3 |
| D06 / #154 | Callouts: foldable and remaining types | P3 |
| D07 / #155 | Tabs: pin and jump by number | P3 |
| D09 / #157 | Rebindable keyboard shortcuts | P3 |
| D10 / #158 | Open or create today's dated note | P3 |
| D12 / #160 | Outgoing-links panel (resolved, unresolved, possible) | P3 |
| D13 / #161 | Extract selection to a new note / merge notes | P3 |
| D14 / #162 | Fold headings and lists | P3 |

The repo has no priority labels for enhancements (`low|medium|high` are bug severities), so labels are `enhancement` (`bug,medium` for D01) and the P-level is in each issue body.

### Existing issues that already cover Obsidian gaps

#107 nested tags, #123 natural sort order, #124 multi-select, #135 external single-file open, #138 light theme, #139 font/zoom, #140 export, #141 docs mismatch, #142 accessibility, #143 localisation, #144 first-run content, #55 `task:` search, #58 PDF search jump.

## Major findings

1. **The one real integrity problem is frontmatter.** Any note with a leading YAML block is silently rewritten into broken text on the first autosave (verified by experiment: newlines collapse, `[a, b]` is escaped, the list detaches). This is separate from the deliberate decision not to build properties, and it matters because the workspace model makes opening an Obsidian vault trivial. This is D01 and the only P1.
2. **Search is the weakest of the core features.** Quotes are stripped, there is no OR or exclusion, and results are hard-capped at 20 with no way to see more. Obsidian's search syntax is the clearest functional gap in everyday use (D02, D03).
3. **Linking is shallower than Obsidian's.** Links point at whole notes only: no display text, no heading targets, no embeds, no outgoing/unresolved view (D04, D05, D12). Backlinks, unlinked mentions, hover preview, rename-safe links and the graph are at parity or better.
4. **File management lacks the basics.** Notes have no context menu, no duplicate, no show-in-Explorer or copy path, no move dialog, even though the opener plugin is installed (D08).
5. **Most of Obsidian's remaining surface is deliberately out.** Canvas, Bases, Publish, Sync, Teams, plugins, themes, CSS snippets, Web Clipper, audio, slides and the 15 importers are cut, out of scope, or served by a different design here (Excalidraw and ink canvas, Git automation, plain files). They are recorded as not applicable or not filed, not as oversights.
6. **Housekeeping.** #136 (action palette, committed in bb0a94a) and #121 (recoverable delete, f471075) are still open although implemented; `.claude/product-audit/FEATURES.md` still lists recoverable delete as missing.

## Prioritised recommendations

1. D01 before anything else: it protects data and unlocks safe use of existing Obsidian notes.
2. D02 and D03 together (same code path, `search_notes`), then D04 (touches the same link plumbing as #122, so sequence with it).
3. D08 and D11 next; D11 needs a recorded storage decision first (bookmarks are user content, so they probably belong inside the workspace, not in the gitignored `.workspace.json`).
4. P3 items on demand; D09 becomes cheap once the palette's command ids are the single registry.
5. Close #136 and #121.

## Architectural and product considerations

- **Path identity vs title-keyed links.** D04, D11, D12 and D13 all interact with the "path is identity, title is the link key" constraint and with #122; plan them together.
- **Storage boundary.** D07 (pinned tabs) is UI state for `.workspace.json`; D09 is machine-local `settings.json`; D11 and D10's template choice are the cases where the column needs a deliberate decision (CLAUDE.md, ROADMAP §1).
- **Non-portable syntax.** D04 and D05 add Obsidian-style syntax. `[[ ]]` already exists; `![[ ]]` is a larger bet (does not render on GitHub), so D05 asks for a short ADR first.
- **Frozen PDF pipeline.** No gap was filed against the pipeline; the PDF viewer gaps (LK-014, LK-016) are recorded as unfiled because the import model is the product's choice.
- **Process execution.** D08's "show in Explorer / open in default app" must follow `src-tauri/src/commands/CLAUDE.md` (no program names or unbounded paths from the frontend).

## Issue status

The batch was shown for approval as the repository's `file-issue` skill requires, approved, and filed with `gh issue create`: #149 (`bug,medium`) and #150-#162 (`enhancement`), all on `TorresVisual/null-notes`. Verified with `gh issue list`. Bodies are in [issue-drafts/](issue-drafts/); see [issue-log.md](issue-log.md).

## Known limitations of this audit

- Tier B documentation (104 pages) was read at heading level; Bases function lists, Importer per-app pages, Web Clipper filters and the CLI command catalogue are inventoried as clusters.
- Only Obsidian Help was crawled. The changelog, the plugin directory and the forum were not, and no community plugin was enumerated.
- Implementation status comes from code reading and greps, plus a single runtime experiment (frontmatter round-trip with StarterKit + tiptap-markdown, the base of the app's editor). The app was not launched, so UI behaviour such as Shift+Enter, paste handling and nested-callout round-trip is marked unverified rather than assumed.
- The frontmatter experiment used the stock extension set, not the app's full set. No app extension handles frontmatter (grep), so the result is expected to hold, but it is not a test of the running app.
- "Not filed" decisions for niche items are judgement calls for a one-maintainer product; they are listed so they can be reversed.
- The repository changed during the audit (the action palette and recoverable delete landed as commits); evidence reflects `main` at e94c854.
