# Implementation gaps: Obsidian vs Null Notes

Confirmed missing and partially implemented features, generated from [feature-inventory.json](feature-inventory.json). 116 entries: 81 not filed (reason recorded), 23 new issue (filed), 12 existing issue.
Priorities are suggested (P0 critical, P1 high, P2 medium, P3 low) and exist only for gaps with a draft or tracked issue; gaps that were deliberately not filed carry the reason instead. Items with status "unverified" are not gaps and are listed in [competitor-audit.md](competitor-audit.md).

## Gaps with a newly filed issue (by priority)

### P1

#### D01: Notes with YAML frontmatter are rewritten and corrupted when edited
- Features: TG-005
  - **TG-005** (missing): Opening and editing a note with YAML frontmatter (e.g. from an Obsidian vault) corrupts the header; markdown-it parses it as hr + paragraph + hr. Evidence: Experiment (StarterKit + tiptap-markdown): "---\ntitle: Foo\ntags: [a, b]\naliases:\n  - Bar\n---" round-trips to "---\n\ntitle: Foo tags: \\[a, b\\] aliases:\n\n- Bar\n\n---"
- Product relevance: Silent content corruption of user data; any note imported from an Obsidian vault, Jekyll/Hugo site or similar carries frontmatter.
- Issue: [#149](https://github.com/TorresVisual/null-notes/issues/149) (draft [D01](issue-drafts/D01.md))

### P2

#### D02: Search: support exact phrases, OR, exclusion and grouping
- Features: SR-003, SR-004, SR-005, SR-006
  - **SR-003** (missing): Typing "exact phrase" matches the words anywhere, in any order. Evidence: notes.rs:1667 strips every " from each word and re-quotes it as a prefix term
  - **SR-004** (missing): No OR; "OR" is searched as a literal word. Evidence: notes.rs:1663-1672 joins all terms with implicit AND
  - **SR-005** (missing): No way to exclude notes by term. Evidence: No NOT handling in notes.rs or lib/searchQuery.ts
  - **SR-006** (missing): No grouping. Evidence: No grouping in searchQuery.ts
- Product relevance: Search is the main recall tool at course volume; today every query is an AND of prefix terms, so narrowing or widening is impossible.
- Issue: [#150](https://github.com/TorresVisual/null-notes/issues/150) (draft [D02](issue-drafts/D02.md))

#### D03: Search shows at most 20 results and offers no sort order
- Features: SR-014
  - **SR-014** (missing): Results are capped at 20 with no way to see more and no sort choice. Evidence: db/notes.rs:210-214 hard-codes LIMIT 20, ORDER BY rank or updated_at DESC
- Product relevance: Hard-capped results hide matching notes with no signal that anything is missing.
- Issue: [#151](https://github.com/TorresVisual/null-notes/issues/151) (draft [D03](issue-drafts/D03.md))

#### D04: Wiki-links can't carry display text or point at a heading
- Features: LK-003, LK-004
  - **LK-003** (missing): [[A|B]] becomes an unresolved link to a note named "A|B". Evidence: WikiLink.tsx:251-273 serialises/parses only [[title]]; regex /\[\[([^\]\n]+)\]\]/ treats "A|B" as a title
  - **LK-004** (missing): No heading-level link targets. Evidence: No anchor parsing in WikiLink.tsx; navigation jumps to notes only (cross-refs cover callouts/equations)
- Product relevance: Heading targets and custom link text are the two most-used link forms after the plain title; without them a long note can only be linked as a whole.
- Issue: [#152](https://github.com/TorresVisual/null-notes/issues/152) (draft [D04](issue-drafts/D04.md))

#### D08: Notes have no context menu: duplicate, show in Explorer, copy path, move to...
- Features: FL-011, FL-012, FL-013, FL-014
  - **FL-011** (missing): No way to copy a note with its sidecars. Evidence: TreeNode.tsx note rows have only inline rename/delete buttons; no duplicate command in notes.rs
  - **FL-012** (partial): Only drag-and-drop; no keyboard/dialog move. Evidence: Drag-and-drop move (FolderTree.tsx); notes.rs move_note
  - **FL-013** (missing): No note-level "Show in Explorer", "Open in default app" or "Copy path". Evidence: tauri-plugin-opener is installed with opener:default (capabilities/default.json) but no UI calls it for notes
  - **FL-014** (missing): No context menu on notes or tabs. Evidence: Folders have a context menu (TreeNode.tsx:243); note rows do not
- Product relevance: File-management basics that every file explorer offers; the opener plugin is already installed, so the gap is UI and a couple of commands.
- Issue: [#156](https://github.com/TorresVisual/null-notes/issues/156) (draft [D08](issue-drafts/D08.md))

#### D11: Bookmarks: pin notes, headings and saved searches in the sidebar
- Features: PL-008
  - **PL-008** (missing): No way to pin notes, headings or saved searches. Evidence: No bookmark/favourite concept (grep none)
- Product relevance: Gives course-level quick access without a query language, the cheap answer to Obsidian Bases that the roadmap prefers (ROADMAP §4).
- Issue: [#159](https://github.com/TorresVisual/null-notes/issues/159) (draft [D11](issue-drafts/D11.md))

### P3

#### D05: Embed a note or heading inside another note
- Features: LK-011
  - **LK-011** (missing): No transclusion of notes or headings. Evidence: No embed node; no "![[" handling in extensions/
- Product relevance: Useful for assembling a revision sheet from existing notes, but it adds non-portable syntax; the roadmap already flags it as low priority.
- Issue: [#153](https://github.com/TorresVisual/null-notes/issues/153) (draft [D05](issue-drafts/D05.md))

#### D06: Callouts: foldable ([!type]+/-) and the remaining Obsidian callout types
- Features: ED-017, ED-018
  - **ED-017** (partial): Obsidian types such as abstract, todo, success, question, failure, bug, quote are not recognised and stay plain blockquotes. Evidence: extensions/Callout.tsx:160 regex accepts 13 fixed types (NOTE, TIP, WARNING, DANGER, INFO, IMPORTANT + STEM types)
  - **ED-018** (missing): "[!note]- Title" becomes a title of "- Title"; the callout cannot collapse. Details.tsx is a separate node. Evidence: Callout.tsx:160-168: the fold marker is captured into the title text
- Product relevance: Only matters for notes shared with or imported from Obsidian; content is not lost today but renders wrongly.
- Issue: [#154](https://github.com/TorresVisual/null-notes/issues/154) (draft [D06](issue-drafts/D06.md))

#### D07: Tabs: pin a tab and jump to a tab by number
- Features: UI-003, UI-004
  - **UI-003** (missing): No numeric tab shortcuts. Evidence: Layout.tsx:502-526 KEY_COMMANDS has no digit keys
  - **UI-004** (missing): No pinning. Evidence: TabBar.tsx has no pin state; store/workspace.ts
- Product relevance: Small ergonomics gain for people who keep a reference note open while working through others.
- Issue: [#155](https://github.com/TorresVisual/null-notes/issues/155) (draft [D07](issue-drafts/D07.md))

#### D09: Let users rebind keyboard shortcuts
- Features: UI-015
  - **UI-015** (missing): Shortcuts are fixed. Evidence: Layout.tsx:502 hard-coded KEY_COMMANDS; no keymap setting in AppSettings
- Product relevance: Matters mainly for people whose layout or habits clash with the fixed set; now cheaper because the action palette gives every command an id.
- Issue: [#157](https://github.com/TorresVisual/null-notes/issues/157) (draft [D09](issue-drafts/D09.md))

#### D10: One command to open or create today's dated note
- Features: PL-009
  - **PL-009** (missing): No dated-note command. Evidence: No daily-note code; TemplateDialog.tsx has a date field only
- Product relevance: Convenience for lecture/lab logs; templates already cover the content, so only the dated entry point is missing.
- Issue: [#158](https://github.com/TorresVisual/null-notes/issues/158) (draft [D10](issue-drafts/D10.md))

#### D12: Outgoing-links panel: resolved, unresolved and potential links
- Features: PL-003
  - **PL-003** (missing): No view of a note's outgoing or unresolved links; no suggestions for linking existing note titles mentioned in the text. Evidence: No panel; lib/noteLinks.ts extracts links but only for backlinks/graph
- Product relevance: Helps keep a growing workspace connected and finds broken links; the data already exists for backlinks.
- Issue: [#160](https://github.com/TorresVisual/null-notes/issues/160) (draft [D12](issue-drafts/D12.md))

#### D13: Extract selected text into a new note, and merge two notes
- Features: PL-013
  - **PL-013** (missing): Splitting a long lecture note or merging two requires manual copy-paste and link fixing. Evidence: No merge/extract command in notes.rs
- Product relevance: Reorganising notes is a periodic need (long lecture notes, exercise sheets); doable by hand today but error-prone because links and sidecars must follow.
- Issue: [#161](https://github.com/TorresVisual/null-notes/issues/161) (draft [D13](issue-drafts/D13.md))

#### D14: Fold headings and lists in long notes
- Features: ED-026
  - **ED-026** (missing): Headings and list items cannot be folded; no fold-all/unfold-all command. Evidence: No heading-fold plugin; only collapsible Details block (extensions/Details.tsx) and code-block fold
- Product relevance: Navigation aid for long notes; the Outline panel and collapsible blocks cover part of the need.
- Issue: [#162](https://github.com/TorresVisual/null-notes/issues/162) (draft [D14](issue-drafts/D14.md))

## Gaps covered by an existing issue

| Issue | Features | What the gap is |
|---|---|---|
| #55 | SR-011 | Tracked. |
| #58 | LK-017 | Search results cannot jump to the matching PDF page; no copy-as-quote. |
| #107 | TG-002, SR-008 | Tags are flat; no hierarchy or parent matching.; No nested-tag matching (see TG-002). |
| #123 | FL-016 | Single fixed order; natural sort is #123. |
| #124 | FL-017 | Tracked. |
| #135 | FL-015 | Edits a temp copy; never reaches the original. |
| #138 | UI-020 | Tracked. |
| #139 | UI-021 | Tracked. |
| #140 | IM-018 | Tracked. |
| #143 | UI-019 | Tracked. |
| #144 | ON-001 | New workspaces open empty. |

## Gaps deliberately not filed

### Editing and formatting

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| ED-003 | Highlight ==text== with colours | partial | Functional equivalence, syntax differs. Not filed: no need for the emoji syntax. |
| ED-011 | Comments %%hidden%% | missing | Not filed: HTML comments already serve as portable hidden text (SR card state uses them). Low value for a solo CS-notes user. |
| ED-015 | Mermaid diagrams | partial | Not filed: niche; the Excalidraw DiagramBlock covers structured diagrams. |
| ED-023 | Selection-less copy/cut paragraph; delete line (Ctrl+Shift+K) | missing | Not filed: micro-interaction; BlockHandle already offers duplicate/move/delete per block. |
| ED-024 | Reading view vs Editing view (Ctrl+E) | partial | Not filed: a separate reading view has low value in a WYSIWYG editor; focus mode (Ctrl+Shift+F) covers distraction-free reading. |
| ED-027 | Multiple cursors and rectangular selection | missing | Not filed: ROADMAP §8 "deliberately left off" - a subsystem, not a backlog item. |
| ED-030 | Embed web pages via iframe | missing | Not filed: forbidden by the security posture; would need a CSP exception and a trust model. |
| ED-031 | Block identifiers (^id) and block references | missing | Deferred: depends on D04/D05; block IDs add non-portable markers to linked paragraphs. |
| ED-032 | Add attachments by paste or drag | partial | Not filed: audio/video are cut (ROADMAP §4); generic file attachments have no stated need. |
| ED-037 | Auto-pair brackets / Markdown syntax; smart lists | partial | Not filed: marginal in a WYSIWYG editor. |
| ED-039 | Right-to-left default direction | missing | Not filed: no RTL need; revisit with i18n (#143). |
| ED-040 | Vim key bindings | missing | Not filed: low priority for a WYSIWYG block editor; code links open the user's own editor. |
| ED-042 | Default view/mode for new tabs; mode in status bar | partial | Not filed: single-mode default is a design choice. |

### Linking notes and files

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| LK-005 | Link to a block [[Note#^id]] | missing | See ED-031. |
| LK-006 | Markdown-style internal links and link-format settings | partial | Not filed: title-keyed wikilinks are the product decision (ROADMAP §2); revisit with #122. |
| LK-010 | Note aliases in link suggestions and unlinked mentions | missing | Not filed: requires properties, deferred by decision (ROADMAP §5). |
| LK-013 | Embed audio and video files | missing | Not filed: audio/lecture recording is cut (ROADMAP §4: "An audio file is not a .md"). |
| LK-014 | Embed a PDF (page/height options) | partial | Not filed: PDF import is the product's PDF model; pipeline is frozen. |
| LK-015 | Embed a canvas, base, list block or search results | missing | Deferred with D05; query embeds conflict with ROADMAP §4 (query blocks challenged). |
| LK-016 | Built-in PDF viewer (thumbnails, TOC, zoom, page layouts) | partial | Not filed: viewing is delegated to import; pipeline frozen. |
| LK-018 | Export a note to PDF with page size, orientation, margins, scale | partial | Not filed: unverified whether defaults suffice; other export formats are #140. |

### Tags and properties

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| TG-003 | Tags view with counts, sort, expand/collapse | partial | Nested part covered by #107. |
| TG-004 | Typed properties (YAML frontmatter) with UI | missing | Not filed: deferred by explicit decision with a named trigger. The related integrity defect is D01. |
| TG-006 | Properties view: file properties, all properties, global rename | missing | Depends on TG-004 (deferred). |
| TG-007 | Search by property [prop:value] | missing | Depends on TG-004 (deferred). |

### Search and navigation

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| SR-009 | file: and content: operators | missing | Not filed: Quick Switcher already covers title lookup; low demand. |
| SR-010 | line: / block: / section: scoped matching | missing | Not filed: niche; would need block-level indexing. |
| SR-012 | Case-sensitive search and regular expressions | missing | Not filed: FTS5 cannot do regex; would need a separate scan path; low demand. |
| SR-013 | Property search | missing | Depends on TG-004 (deferred). |
| SR-018 | Search selected text; copy results; explain search term; search in folder | missing | Not filed: marginal. |
| SR-019 | Embed live search results in a note | missing | Not filed: ROADMAP §4 challenges query blocks. |
| SR-021 | Random note | missing | Not filed: trivial; no stated need. |

### Files and vaults

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| FL-007 | Accepted file formats (md, base, canvas, images, audio, video, pdf) | partial | Not filed: audio/video cut (ROADMAP §4); canvas/base see CV/BS. |
| FL-019 | Search in folder (context menu) | partial | Not filed: folder: operator covers the need. |
| FL-020 | File recovery snapshots | partial | Not filed: ROADMAP §4 says history should be a thin wrapper over Git or nothing. |
| FL-024 | Word and character count | partial | Not filed: trivial. |

### Interface and workspace

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| UI-006 | Split panes | partial | Not filed: two panes cover the sheet-and-solution case that motivated it. |
| UI-007 | Stacked tab groups and linked views | missing | Not filed: niche. |
| UI-008 | Pop-out windows / move tab to new window | missing | Not filed: deferred by explicit decision. |
| UI-009 | Named workspace layouts (save/load) | partial | Not filed: last-session restore covers the common case. |
| UI-010 | Sidebars with tab groups for plugin views | partial | Not filed: fixed layout is a design choice. |
| UI-014 | Pinned commands in the palette | missing | Not filed: marginal. |
| UI-017 | Drag and drop of tabs, files and content | partial | Not filed: unverified. |
| UI-018 | Settings organised into categories | partial | Not filed: marginal. |
| UI-022 | Custom themes and CSS snippets | missing | Not filed: brand ("Terminal Precision") is a deliberate commitment and plugin-like extension points are out of scope (ROADMAP §7). |

### Core plugins

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| PL-002 | Backlink filtering, sorting, collapse, more context, in-document footer | partial | Not filed: low volume per note. |
| PL-005 | Graph filters, colour groups, forces, orphans toggle, time-lapse | partial | Not filed: graph is a secondary view; scoping (#36) covered the hairball problem. |
| PL-006 | Local graph for the active note | missing | Not filed: per-note relationship graph is explicitly de-scoped (ROADMAP §4, issue #71 notes). |
| PL-010 | Unique note creator (timestamp-named note) | missing | Folded into D10 scope notes; not separately filed. |
| PL-012 | Insert a template into the active note; insert current date/time | partial | Not filed: unverified. |
| PL-015 | Footnotes view | missing | Not filed: tiny; footnotes are visible inline. |
| PL-017 | Slides: present a note | missing | Not filed: cut (ROADMAP §4). |
| PL-018 | Record audio into a note | missing | Not filed: cut (ROADMAP §4). |
| PL-019 | Open external links inside the app, reader view, save to vault | missing | Not filed: a browser is a different product surface; web capture is out of scope. |
| PL-020 | Properties view | missing | Depends on TG-004. |

### Canvas

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| CV-001 | Infinite canvas with note, text, media, web and base cards | partial | Not filed: overlaps ink canvas + Excalidraw diagrams; card canvas is a different product surface. |
| CV-002 | Connect cards with labelled, directed, coloured lines; follow connection | partial | Not filed: see CV-001. |
| CV-003 | Align, arrange and distribute selected cards | partial | See CV-001. |
| CV-004 | JSON Canvas (.canvas) open file format | missing | Not filed: no interop need. |

### Bases

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| BS-001 | Bases: database views over note properties (table, list, cards, kanban, map) | missing | Not filed: ROADMAP §4 ("query blocks/Dataview-lite challenged") and properties are deferred. D11 (bookmarks/saved searches) is the cheaper answer. |
| BS-002 | Formulas, functions, summaries, embed a base, export CSV | missing | Depends on BS-001; same decision. |

### Import and export

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| IM-002 | Import from Notion | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-003 | Import from Evernote | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-004 | Import from Microsoft OneNote | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-005 | Import from Apple Notes | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-006 | Import from Apple Journal | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-007 | Import from Google Keep | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-008 | Import from Bear | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-009 | Import from Craft | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-010 | Import from Roam Research | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-011 | Import from Logseq | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-012 | Import from Airtable | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-013 | Import from Tomboy and Gnote | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-014 | Import from HTML files | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-015 | Import from CSV files | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-016 | Import from Textbundle files | missing | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |

### Extending and automation

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| EX-005 | CSS snippets | missing | Not filed: see UI-022. |
| EX-006 | Obsidian URI (open, new, search, daily note, x-callback) | missing | Not filed: no concrete consumer; a reverse link from the sibling null-ide is a cross-repo item. |
| EX-007 | Command-line interface (~110 commands) and headless mode | missing | Not filed: no consumer; the workspace is plain files so ordinary tools already work. |

### Mobile

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| MB-001 | Mobile apps (iOS, iPadOS, Android) | partial | Existing mobile issues track the gaps. |

### Onboarding and documentation

| ID | Feature | Status | Reason not filed |
|---|---|---|---|
| ON-002 | Built-in help and documentation | partial | Not filed: part of first-run work (#144). |
