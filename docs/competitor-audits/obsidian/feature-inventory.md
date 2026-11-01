# Feature inventory: Obsidian vs Null Notes

Generated from [feature-inventory.json](feature-inventory.json) (the source of truth), audit date 2026-10-31. Status words: Implemented, Partial, Missing, N/A (not applicable, rationale in the JSON), Unverified. Issue column: `#n` = GitHub issue (#149-#162 were filed by this audit, the rest already existed; see [issue-log.md](issue-log.md)), `-` = none.

| Category | Features | Implemented | Partial | Missing | N/A | Unverified |
|---|---|---|---|---|---|---|
| Editing and formatting | 42 | 20 | 7 | 9 | 3 | 3 |
| Linking notes and files | 18 | 5 | 5 | 7 | 0 | 1 |
| Tags and properties | 8 | 1 | 2 | 4 | 1 | 0 |
| Search and navigation | 22 | 8 | 1 | 13 | 0 | 0 |
| Files and vaults | 24 | 9 | 7 | 4 | 1 | 3 |
| Interface and workspace | 24 | 7 | 5 | 10 | 2 | 0 |
| Core plugins | 21 | 6 | 3 | 11 | 1 | 0 |
| Canvas | 4 | 0 | 3 | 1 | 0 | 0 |
| Bases | 2 | 0 | 0 | 2 | 0 | 0 |
| Import and export | 18 | 2 | 0 | 16 | 0 | 0 |
| Extending and automation | 8 | 0 | 0 | 3 | 5 | 0 |
| Web capture | 5 | 0 | 0 | 0 | 5 | 0 |
| Sync, publish and services | 10 | 0 | 0 | 0 | 10 | 0 |
| Mobile | 2 | 0 | 1 | 0 | 0 | 1 |
| Onboarding and documentation | 3 | 0 | 2 | 0 | 0 | 1 |
| **Total** | **211** | 58 | 36 | 80 | 28 | 9 |

## Editing and formatting

### Basic syntax

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-001 | Headings H1-H6 | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |
| ED-002 | Bold / italic / bold-italic / strikethrough | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |
| ED-003 | Highlight ==text== with colours | Partial | [syntax](https://obsidian.md/help/syntax) | - | Obsidian colour-emoji syntax (==🔴x==) is not parsed; emoji renders as text. The capability itself (coloured highlight) exists. |
| ED-004 | Paragraphs, line breaks, strict line breaks | Unverified | [syntax](https://obsidian.md/help/syntax) | - | Shift+Enter binding not verified; no strict-line-breaks setting (likely irrelevant in WYSIWYG). |
| ED-005 | Blockquotes | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |
| ED-006 | Ordered, unordered and nested lists | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |
| ED-007 | Task lists | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |
| ED-008 | Horizontal rule | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |
| ED-009 | Inline code and fenced code blocks | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |
| ED-010 | Footnotes | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |
| ED-011 | Comments %%hidden%% | Missing | [syntax](https://obsidian.md/help/syntax) | - | %%x%% renders as ordinary text. |
| ED-012 | Escaping Markdown with backslash | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |
| ED-013 | External links and external images | Implemented | [syntax](https://obsidian.md/help/syntax) | - |  |

### Advanced syntax

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-014 | Tables with inline formatting | Implemented | [advanced-syntax](https://obsidian.md/help/advanced-syntax) | - |  |
| ED-015 | Mermaid diagrams | Partial | [advanced-syntax](https://obsidian.md/help/advanced-syntax) | - | Linking Mermaid nodes to notes is unsupported. |
| ED-016 | Math (LaTeX, inline and block) | Implemented | [advanced-syntax](https://obsidian.md/help/advanced-syntax) | - |  |

### Callouts

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-017 | Callout types | Partial | [callouts](https://obsidian.md/help/callouts) | #154 | Obsidian types such as abstract, todo, success, question, failure, bug, quote are not recognised and stay plain blockquotes. |
| ED-018 | Foldable callouts ([!type]+ / [!type]-) | Missing | [callouts](https://obsidian.md/help/callouts) | #154 | "[!note]- Title" becomes a title of "- Title"; the callout cannot collapse. Details.tsx is a separate node. |
| ED-019 | Nested callouts | Unverified | [callouts](https://obsidian.md/help/callouts) | - | Nesting round-trip not verified. |
| ED-020 | Custom callout types and colours via CSS | N/A | [callouts](https://obsidian.md/help/callouts) | - | Depends on CSS snippets / plugins, both out of scope. |

### Editing shortcuts

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-021 | Standard text editing and navigation keys | Implemented | [editing-shortcuts](https://obsidian.md/help/editing-shortcuts) | - |  |
| ED-022 | Paste without formatting (Ctrl+Shift+V) | Unverified | [editing-shortcuts](https://obsidian.md/help/editing-shortcuts) | - | Not verified in the running app. |
| ED-023 | Selection-less copy/cut paragraph; delete line (Ctrl+Shift+K) | Missing | [editing-shortcuts](https://obsidian.md/help/editing-shortcuts) | - | No selection-less line shortcuts. |

### Views

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-024 | Reading view vs Editing view (Ctrl+E) | Partial | [edit-and-read](https://obsidian.md/help/edit-and-read) | - | No read-only presentation mode. Equivalent need is largely met by WYSIWYG. |
| ED-025 | Live Preview and Source mode | Implemented | [edit-and-read](https://obsidian.md/help/edit-and-read) | - |  |

### Folding

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-026 | Fold headings and lists; fold all / unfold all | Missing | [folding](https://obsidian.md/help/folding) | #162 | Headings and list items cannot be folded; no fold-all/unfold-all command. |

### Multiple cursors

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-027 | Multiple cursors and rectangular selection | Missing | [multiple-cursors](https://obsidian.md/help/multiple-cursors) | - | Not filed: ROADMAP §8 "deliberately left off" - a subsystem, not a backlog item. |

### Find and replace

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-028 | Find and replace in the current note | Implemented | [find-and-replace](https://obsidian.md/help/find-and-replace) | - |  |

### HTML

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-029 | Inline HTML with sanitisation | Implemented | [html](https://obsidian.md/help/html) | - |  |
| ED-030 | Embed web pages via iframe | Missing | [embed-web-pages](https://obsidian.md/help/embed-web-pages) | - | iframes are deliberately stripped. |

### Obsidian Flavored Markdown

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-031 | Block identifiers (^id) and block references | Missing | [obsidian-flavored-markdown](https://obsidian.md/help/obsidian-flavored-markdown) | - | No block-level link targets. |

### Attachments

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-032 | Add attachments by paste or drag | Partial | [attachments](https://obsidian.md/help/attachments) | - | Only images are handled; dropping PDF/audio/video/other files does nothing (PDFs go through ImportButton as an import). |
| ED-033 | Configurable attachment location | N/A | [attachments](https://obsidian.md/help/attachments) | - | Design difference: sidecars travel with the note by contract; configurable locations would break rename/move handling. |

### Editor settings

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ED-034 | Readable line length | Implemented | [settings](https://obsidian.md/help/settings) | - |  |
| ED-035 | Spellcheck and language | Implemented | [settings](https://obsidian.md/help/settings) | - |  |
| ED-036 | Line numbers, indentation guides, fold indent | N/A | [settings](https://obsidian.md/help/settings) | - | Not applicable to a prose WYSIWYG model. |
| ED-037 | Auto-pair brackets / Markdown syntax; smart lists | Partial | [settings](https://obsidian.md/help/settings) | - | No bracket auto-pairing in prose. |
| ED-038 | Indent with tabs / indent width | Implemented | [settings](https://obsidian.md/help/settings) | - |  |
| ED-039 | Right-to-left default direction | Missing | [settings](https://obsidian.md/help/settings) | - | No RTL setting. |
| ED-040 | Vim key bindings | Missing | [settings](https://obsidian.md/help/settings) | - | Not filed: low priority for a WYSIWYG block editor; code links open the user's own editor. |
| ED-041 | Convert pasted HTML to Markdown | Implemented | [settings](https://obsidian.md/help/settings) | - |  |
| ED-042 | Default view/mode for new tabs; mode in status bar | Partial | [settings](https://obsidian.md/help/settings) | - | No default-mode setting (always WYSIWYG). |

## Linking notes and files

### Internal links

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| LK-001 | Wikilink [[Note]] with [[ autocomplete | Implemented | [links](https://obsidian.md/help/links) | - |  |
| LK-002 | Link to a non-existing note; create on click | Implemented | [links](https://obsidian.md/help/links) | - |  |
| LK-003 | Link display text [[Note/text]] | Missing | [links](https://obsidian.md/help/links) | #152 | [[A/B]] becomes an unresolved link to a note named "A/B". |
| LK-004 | Link to a heading [[Note#Heading]] | Missing | [links](https://obsidian.md/help/links) | #152 | No heading-level link targets. |
| LK-005 | Link to a block [[Note#^id]] | Missing | [links](https://obsidian.md/help/links) | - | Missing; deferred behind D04/D05. |
| LK-006 | Markdown-style internal links and link-format settings | Partial | [links](https://obsidian.md/help/links) | - | Generated links are always [[Title]]. |
| LK-007 | Create link from selected text; Add internal link command | Unverified | [links](https://obsidian.md/help/links) | - | Not verified. |
| LK-008 | Hover preview of linked notes | Implemented | [plugins/page-preview](https://obsidian.md/help/plugins/page-preview) | - |  |
| LK-009 | Automatic link updates on rename | Implemented | [links](https://obsidian.md/help/links) | - |  |

### Aliases

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| LK-010 | Note aliases in link suggestions and unlinked mentions | Missing | [aliases](https://obsidian.md/help/aliases) | - | No alias concept. |

### Embeds

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| LK-011 | Embed a note or heading in another note ![[Note]] | Missing | [embeds](https://obsidian.md/help/embeds) | #153 | No transclusion of notes or headings. |
| LK-012 | Embed images | Implemented | [embeds](https://obsidian.md/help/embeds) | - |  |
| LK-013 | Embed audio and video files | Missing | [embeds](https://obsidian.md/help/embeds) | - | Not filed: audio/lecture recording is cut (ROADMAP §4: "An audio file is not a .md"). |
| LK-014 | Embed a PDF (page/height options) | Partial | [embeds](https://obsidian.md/help/embeds) | - | Arbitrary PDFs cannot be embedded; only the import pipeline produces PDF page blocks. |
| LK-015 | Embed a canvas, base, list block or search results | Missing | [embeds](https://obsidian.md/help/embeds) | - | Deferred with D05; query embeds conflict with ROADMAP §4 (query blocks challenged). |

### PDFs

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| LK-016 | Built-in PDF viewer (thumbnails, TOC, zoom, page layouts) | Partial | [pdf](https://obsidian.md/help/pdf) | - | No standalone viewer tab; no thumbnails/TOC/two-page modes. |
| LK-017 | Search in a PDF; copy text / quote / link to selection | Partial | [pdf](https://obsidian.md/help/pdf) | #58 | Search results cannot jump to the matching PDF page; no copy-as-quote. |
| LK-018 | Export a note to PDF with page size, orientation, margins, scale | Partial | [pdf](https://obsidian.md/help/pdf) | - | No page-size / landscape / margin / scale options. |

## Tags and properties

### Tags

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| TG-001 | Inline #tags with format rules | Implemented | [tags](https://obsidian.md/help/tags) | - |  |
| TG-002 | Nested tags with parent matching | Partial | [tags](https://obsidian.md/help/tags) | #107 | Tags are flat; no hierarchy or parent matching. |
| TG-003 | Tags view with counts, sort, expand/collapse | Partial | [plugins/tags](https://obsidian.md/help/plugins/tags) | - | Sort-by-frequency and nested expand not verified. |

### Properties

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| TG-004 | Typed properties (YAML frontmatter) with UI | Missing | [properties](https://obsidian.md/help/properties) | - | No properties model or UI. |
| TG-005 | Frontmatter survives open and save unchanged | Missing | [properties](https://obsidian.md/help/properties) | #149 | Opening and editing a note with YAML frontmatter (e.g. from an Obsidian vault) corrupts the header; markdown-it parses it as hr + paragraph + hr. |
| TG-006 | Properties view: file properties, all properties, global rename | Missing | [plugins/properties](https://obsidian.md/help/plugins/properties) | - | Depends on TG-004 (deferred). |
| TG-007 | Search by property [prop:value] | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | - | Depends on TG-004 (deferred). |
| TG-008 | Format converter for deprecated property formats | N/A | [plugins/format-converter](https://obsidian.md/help/plugins/format-converter) | - | N/A: no legacy Obsidian property formats exist in this app. |

## Search and navigation

### Search

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| SR-001 | Full-text search across the workspace | Implemented | [plugins/search](https://obsidian.md/help/plugins/search) | - |  |
| SR-002 | Multi-word AND search | Implemented | [plugins/search](https://obsidian.md/help/plugins/search) | - |  |
| SR-003 | Exact phrase search | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | #150 | Typing "exact phrase" matches the words anywhere, in any order. |
| SR-004 | OR operator | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | #150 | No OR; "OR" is searched as a literal word. |
| SR-005 | Exclusion (-term, -(a b)) | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | #150 | No way to exclude notes by term. |
| SR-006 | Grouping with parentheses | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | #150 | No grouping. |
| SR-007 | folder: / path: operator | Implemented | [plugins/search](https://obsidian.md/help/plugins/search) | - |  |
| SR-008 | tag: operator | Partial | [plugins/search](https://obsidian.md/help/plugins/search) | #107 | No nested-tag matching (see TG-002). |
| SR-009 | file: and content: operators | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | - | Cannot scope a term to file name or body. |
| SR-010 | line: / block: / section: scoped matching | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | - | Not filed: niche; would need block-level indexing. |
| SR-011 | task:, task-todo:, task-done: operators | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | #55 | Tracked. |
| SR-012 | Case-sensitive search and regular expressions | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | - | Not filed: FTS5 cannot do regex; would need a separate scan path; low demand. |
| SR-013 | Property search | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | - | Depends on TG-004 (deferred). |
| SR-014 | Result list size and sort order | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | #151 | Results are capped at 20 with no way to see more and no sort choice. |
| SR-015 | Context snippets and highlighted matches | Implemented | [plugins/search](https://obsidian.md/help/plugins/search) | - |  |
| SR-016 | Jump to and highlight match in the note | Implemented | [plugins/search](https://obsidian.md/help/plugins/search) | - |  |
| SR-017 | Recent search terms | Implemented | [plugins/search](https://obsidian.md/help/plugins/search) | - |  |
| SR-018 | Search selected text; copy results; explain search term; search in folder | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | - | Not filed: marginal. |
| SR-019 | Embed live search results in a note | Missing | [plugins/search](https://obsidian.md/help/plugins/search) | - | Not filed: ROADMAP §4 challenges query blocks. |

### Navigation

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| SR-020 | Quick switcher (open or create by name, fuzzy) | Implemented | [plugins/quick-switcher](https://obsidian.md/help/plugins/quick-switcher) | - |  |
| SR-021 | Random note | Missing | [plugins/random-note](https://obsidian.md/help/plugins/random-note) | - | Not filed: trivial; no stated need. |
| SR-022 | Back/forward navigation history | Implemented | [tabs](https://obsidian.md/help/tabs) | - |  |

## Files and vaults

### Storage

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| FL-001 | Plain Markdown files in a folder are the source of truth | Implemented | [data-storage](https://obsidian.md/help/data-storage) | - |  |
| FL-002 | Rebuildable metadata cache | Implemented | [data-storage](https://obsidian.md/help/data-storage) | - |  |
| FL-003 | Open an existing folder as a vault; vault switcher | Implemented | [manage-vaults](https://obsidian.md/help/manage-vaults) | - |  |
| FL-004 | Rename, move or remove a vault from the list | Unverified | [manage-vaults](https://obsidian.md/help/manage-vaults) | - | Remove-from-list / rename not verified. |
| FL-005 | Per-vault configuration folder and override | N/A | [configuration-folder](https://obsidian.md/help/configuration-folder) | - | Design difference: settings are machine-local; only .workspace.json travels. |
| FL-006 | Symlinks and junctions in a vault | Unverified | [symlinks](https://obsidian.md/help/symlinks) | - | Behaviour with symlinks not verified. |
| FL-007 | Accepted file formats (md, base, canvas, images, audio, video, pdf) | Partial | [file-formats](https://obsidian.md/help/file-formats) | - | No audio/video playback, no .canvas/.base files. |

### Notes

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| FL-008 | Create note (Ctrl+N) and folder | Implemented | [manage-notes](https://obsidian.md/help/manage-notes) | - |  |
| FL-009 | Rename note (F2) preserving links | Implemented | [manage-notes](https://obsidian.md/help/manage-notes) | - |  |
| FL-010 | Delete a note recoverably | Implemented | [manage-notes](https://obsidian.md/help/manage-notes) | #121 |  |
| FL-011 | Duplicate a note or folder | Missing | [plugins/file-explorer](https://obsidian.md/help/plugins/file-explorer) | #156 | No way to copy a note with its sidecars. |
| FL-012 | Move note via "Move file to..." dialog | Partial | [manage-notes](https://obsidian.md/help/manage-notes) | #156 | Only drag-and-drop; no keyboard/dialog move. |
| FL-013 | Reveal in file manager, open in default app, copy path | Missing | [more-options-menu](https://obsidian.md/help/more-options-menu) | #156 | No note-level "Show in Explorer", "Open in default app" or "Copy path". |
| FL-014 | Per-note context menu (More options) | Missing | [more-options-menu](https://obsidian.md/help/more-options-menu) | #156 | No context menu on notes or tabs. |
| FL-015 | Open Markdown files from outside the vault | Partial | [manage-notes](https://obsidian.md/help/manage-notes) | #135 | Edits a temp copy; never reaches the original. |

### File explorer

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| FL-016 | Sort order options (name, modified, created) | Partial | [plugins/file-explorer](https://obsidian.md/help/plugins/file-explorer) | #123 | Single fixed order; natural sort is #123. |
| FL-017 | Multi-select and bulk move | Missing | [plugins/file-explorer](https://obsidian.md/help/plugins/file-explorer) | #124 | Tracked. |
| FL-018 | Auto-reveal active file; expand/collapse all | Implemented | [plugins/file-explorer](https://obsidian.md/help/plugins/file-explorer) | - |  |
| FL-019 | Search in folder (context menu) | Partial | [plugins/file-explorer](https://obsidian.md/help/plugins/file-explorer) | - | No shortcut from the tree to a scoped search. |

### Recovery

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| FL-020 | File recovery snapshots | Partial | [plugins/file-recovery](https://obsidian.md/help/plugins/file-recovery) | - | Workspaces that are not Git-backed have no snapshot recovery. |
| FL-021 | Backup guidance | Unverified | [backup](https://obsidian.md/help/backup) | - | No in-app or documented backup guidance verified. |
| FL-022 | Crash-safe writes | Implemented | [data-storage](https://obsidian.md/help/data-storage) | - |  |

### Sync

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| FL-023 | Sync via any file-sync tool or Git | Implemented | [sync-notes](https://obsidian.md/help/sync-notes) | - |  |

### Workspace

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| FL-024 | Word and character count | Partial | [plugins/word-count](https://obsidian.md/help/plugins/word-count) | - | No character count or selection count. |

## Interface and workspace

### Tabs

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| UI-001 | Tabs with drag reorder | Implemented | [tabs](https://obsidian.md/help/tabs) | - |  |
| UI-002 | Next/previous tab shortcuts | Implemented | [tabs](https://obsidian.md/help/tabs) | - |  |
| UI-003 | Jump to tab N / last tab (Ctrl+1..9) | Missing | [tabs](https://obsidian.md/help/tabs) | #155 | No numeric tab shortcuts. |
| UI-004 | Pin a tab | Missing | [tabs](https://obsidian.md/help/tabs) | #155 | No pinning. |
| UI-005 | Reopen recently closed tab | Implemented | [tabs](https://obsidian.md/help/tabs) | - |  |
| UI-006 | Split panes | Partial | [tabs](https://obsidian.md/help/tabs) | - | A single secondary pane; no further splits or vertical split. |
| UI-007 | Stacked tab groups and linked views | Missing | [tabs](https://obsidian.md/help/tabs) | - | Not filed: niche. |
| UI-008 | Pop-out windows / move tab to new window | Missing | [pop-out-windows](https://obsidian.md/help/pop-out-windows) | - | Not filed: deferred by explicit decision. |

### Workspace

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| UI-009 | Named workspace layouts (save/load) | Partial | [plugins/workspaces](https://obsidian.md/help/plugins/workspaces) | - | No named layouts. |
| UI-010 | Sidebars with tab groups for plugin views | Partial | [sidebar](https://obsidian.md/help/sidebar) | - | Fixed panel set; no right sidebar / dockable views. |
| UI-011 | Status bar | Implemented | [status-bar](https://obsidian.md/help/status-bar) | - |  |
| UI-012 | Ribbon and its customisation | N/A | [ribbon](https://obsidian.md/help/ribbon) | - | Different design, same access. |

### Commands

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| UI-013 | Command palette | Implemented | [plugins/command-palette](https://obsidian.md/help/plugins/command-palette) | #136 |  |
| UI-014 | Pinned commands in the palette | Missing | [plugins/command-palette](https://obsidian.md/help/plugins/command-palette) | - | Not filed: marginal. |
| UI-015 | Customisable hotkeys | Missing | [hotkeys](https://obsidian.md/help/hotkeys) | #157 | Shortcuts are fixed. |
| UI-016 | Shortcut cheat sheet | Implemented | [hotkeys](https://obsidian.md/help/hotkeys) | - |  |

### Interface

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| UI-017 | Drag and drop of tabs, files and content | Partial | [drag-and-drop](https://obsidian.md/help/drag-and-drop) | - | Dropping a note from the tree into the editor to insert a link is not verified; dropping non-image files does nothing. |
| UI-018 | Settings organised into categories | Partial | [settings](https://obsidian.md/help/settings) | - | Sections exist; no settings search. No plugin pages. |
| UI-019 | Interface language | Missing | [language](https://obsidian.md/help/language) | #143 | Tracked. |
| UI-020 | Light/dark/OS colour scheme | Missing | [appearance](https://obsidian.md/help/appearance) | #138 | Tracked. |
| UI-021 | Font and zoom settings | Missing | [appearance](https://obsidian.md/help/appearance) | #139 | Tracked. |
| UI-022 | Custom themes and CSS snippets | Missing | [snippets](https://obsidian.md/help/snippets) | - | Not filed: brand ("Terminal Precision") is a deliberate commitment and plugin-like extension points are out of scope (ROADMAP §7). |
| UI-023 | App icon customisation and window translucency | N/A | [appearance](https://obsidian.md/help/appearance) | - | N/A by brand decision. |
| UI-024 | In-app update check | Implemented | [updates](https://obsidian.md/help/updates) | #141 |  |

## Core plugins

### Backlinks

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-001 | Linked and unlinked mentions | Implemented | [plugins/backlinks](https://obsidian.md/help/plugins/backlinks) | - |  |
| PL-002 | Backlink filtering, sorting, collapse, more context, in-document footer | Partial | [plugins/backlinks](https://obsidian.md/help/plugins/backlinks) | - | No sort/filter; no in-document backlinks footer. |

### Outgoing links

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-003 | Outgoing links panel (links, unresolved links, unlinked mentions of other notes) | Missing | [plugins/outgoing-links](https://obsidian.md/help/plugins/outgoing-links) | #160 | No view of a note's outgoing or unresolved links; no suggestions for linking existing note titles mentioned in the text. |

### Graph

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-004 | Graph view | Implemented | [plugins/graph](https://obsidian.md/help/plugins/graph) | - |  |
| PL-005 | Graph filters, colour groups, forces, orphans toggle, time-lapse | Partial | [plugins/graph](https://obsidian.md/help/plugins/graph) | - | No orphan/attachment toggles, colour groups, force sliders or animation. |
| PL-006 | Local graph for the active note | Missing | [plugins/graph](https://obsidian.md/help/plugins/graph) | - | Not filed: per-note relationship graph is explicitly de-scoped (ROADMAP §4, issue #71 notes). |

### Outline

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-007 | Outline of headings | Implemented | [plugins/outline](https://obsidian.md/help/plugins/outline) | - |  |

### Bookmarks

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-008 | Bookmark notes, folders, headings, searches, blocks; groups | Missing | [plugins/bookmarks](https://obsidian.md/help/plugins/bookmarks) | #159 | No way to pin notes, headings or saved searches. |

### Daily notes

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-009 | Open or create today's note from a template | Missing | [plugins/daily-notes](https://obsidian.md/help/plugins/daily-notes) | #158 | No dated-note command. |
| PL-010 | Unique note creator (timestamp-named note) | Missing | [plugins/unique-note](https://obsidian.md/help/plugins/unique-note) | - | Folded into D10 scope notes; not separately filed. |

### Templates

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-011 | Template folder and variables ({{title}}, {{date}}, {{time}}) | Implemented | [plugins/templates](https://obsidian.md/help/plugins/templates) | - |  |
| PL-012 | Insert a template into the active note; insert current date/time | Partial | [plugins/templates](https://obsidian.md/help/plugins/templates) | - | Templates create new notes only (insert-into-active-note not verified). |

### Note composer

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-013 | Merge notes; extract selection into a new note | Missing | [plugins/note-composer](https://obsidian.md/help/plugins/note-composer) | #161 | Splitting a long lecture note or merging two requires manual copy-paste and link fixing. |

### Slash commands

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-014 | Slash commands in the editor | Implemented | [plugins/slash-commands](https://obsidian.md/help/plugins/slash-commands) | - |  |

### Footnotes

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-015 | Footnotes view | Missing | [plugins/footnotes](https://obsidian.md/help/plugins/footnotes) | - | Not filed: tiny; footnotes are visible inline. |

### Page preview

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-016 | Page preview on hover | Implemented | [plugins/page-preview](https://obsidian.md/help/plugins/page-preview) | - |  |

### Slides

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-017 | Slides: present a note | Missing | [plugins/slides](https://obsidian.md/help/plugins/slides) | - | Not filed: cut (ROADMAP §4). |

### Audio recorder

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-018 | Record audio into a note | Missing | [plugins/audio-recorder](https://obsidian.md/help/plugins/audio-recorder) | - | Not filed: cut (ROADMAP §4). |

### Web viewer

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-019 | Open external links inside the app, reader view, save to vault | Missing | [plugins/web-viewer](https://obsidian.md/help/plugins/web-viewer) | - | Not filed: a browser is a different product surface; web capture is out of scope. |

### Properties

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-020 | Properties view | Missing | [plugins/properties](https://obsidian.md/help/plugins/properties) | - | Depends on TG-004. |

### Core plugins

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| PL-021 | Enable/disable individual core plugins | N/A | [plugins](https://obsidian.md/help/plugins) | - | N/A: plugin system out of scope. |

## Canvas

### Canvas

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| CV-001 | Infinite canvas with note, text, media, web and base cards | Partial | [plugins/canvas](https://obsidian.md/help/plugins/canvas) | - | No card-based canvas of notes; ink canvas and diagrams cover free-form drawing only. |
| CV-002 | Connect cards with labelled, directed, coloured lines; follow connection | Partial | [plugins/canvas](https://obsidian.md/help/plugins/canvas) | - | Not linked to notes. |
| CV-003 | Align, arrange and distribute selected cards | Partial | [plugins/canvas](https://obsidian.md/help/plugins/canvas) | - | See CV-001. |
| CV-004 | JSON Canvas (.canvas) open file format | Missing | [plugins/canvas](https://obsidian.md/help/plugins/canvas) | - | Not filed: no interop need. |

## Bases

### Bases

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| BS-001 | Bases: database views over note properties (table, list, cards, kanban, map) | Done | [bases](https://obsidian.md/help/bases) | - | Properties block, `.base` files, five layouts, `![[X.base]]` embed (2026-11-01). Filters and formulas are edited as raw YAML. |
| BS-002 | Formulas, functions, summaries, embed a base, export CSV | Missing | [formulas](https://obsidian.md/help/formulas) | - | Depends on BS-001; same decision. |

## Import and export

### Import

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| IM-001 | Open an existing Markdown folder | Implemented | [import/markdown](https://obsidian.md/help/import/markdown) | - |  |
| IM-002 | Import from Notion | Missing | [import/notion](https://obsidian.md/help/import/notion) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-003 | Import from Evernote | Missing | [import/evernote](https://obsidian.md/help/import/evernote) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-004 | Import from Microsoft OneNote | Missing | [import/onenote](https://obsidian.md/help/import/onenote) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-005 | Import from Apple Notes | Missing | [import/apple-notes](https://obsidian.md/help/import/apple-notes) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-006 | Import from Apple Journal | Missing | [import/apple-journal](https://obsidian.md/help/import/apple-journal) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-007 | Import from Google Keep | Missing | [import/google-keep](https://obsidian.md/help/import/google-keep) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-008 | Import from Bear | Missing | [import/bear](https://obsidian.md/help/import/bear) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-009 | Import from Craft | Missing | [import/craft](https://obsidian.md/help/import/craft) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-010 | Import from Roam Research | Missing | [import/roam](https://obsidian.md/help/import/roam) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-011 | Import from Logseq | Missing | [import/logseq](https://obsidian.md/help/import/logseq) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-012 | Import from Airtable | Missing | [import/airtable](https://obsidian.md/help/import/airtable) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-013 | Import from Tomboy and Gnote | Missing | [import/tomboy](https://obsidian.md/help/import/tomboy) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-014 | Import from HTML files | Missing | [import/html](https://obsidian.md/help/import/html) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-015 | Import from CSV files | Missing | [import/csv](https://obsidian.md/help/import/csv) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |
| IM-016 | Import from Textbundle files | Missing | [import/textbundle](https://obsidian.md/help/import/textbundle) | - | Not filed: single-user app with no stated migration need; revisit if the audience decision changes (PRODUCT.md). |

### Export

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| IM-017 | Export a note to PDF | Implemented | [pdf](https://obsidian.md/help/pdf) | - |  |
| IM-018 | Export notes as Markdown / HTML / zip | Missing | [import](https://obsidian.md/help/import) | #140 | Tracked. |

## Extending and automation

### Plugins

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| EX-001 | Community plugins and plugin store | N/A | [community-plugins](https://obsidian.md/help/community-plugins) | - | Ecosystem described by Help; individual community plugins were not enumerated. |
| EX-002 | Plugin security (restricted mode, review) | N/A | [plugin-security](https://obsidian.md/help/plugin-security) | - | N/A with EX-001. |
| EX-003 | Community directory (scorecards, updates) | N/A | [community-directory](https://obsidian.md/help/community-directory) | - | N/A with EX-001. |

### Customisation

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| EX-004 | Themes | N/A | [themes](https://obsidian.md/help/themes) | - | Light theme is #138. |
| EX-005 | CSS snippets | Missing | [snippets](https://obsidian.md/help/snippets) | - | Not filed: see UI-022. |

### Automation

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| EX-006 | Obsidian URI (open, new, search, daily note, x-callback) | Missing | [uri](https://obsidian.md/help/uri) | - | No URL scheme to open or search a note from outside. |
| EX-007 | Command-line interface (~110 commands) and headless mode | Missing | [cli](https://obsidian.md/help/cli) | - | Not filed: no consumer; the workspace is plain files so ordinary tools already work. |
| EX-008 | Early access / insider builds | N/A | [early-access](https://obsidian.md/help/early-access) | - | N/A. |

## Web capture

### Web Clipper

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| WC-001 | Clip web pages with templates | N/A | [web-clipper/capture](https://obsidian.md/help/web-clipper/capture) | - | N/A: the clipper is an official browser extension, outside the notes app; web capture is out of scope. |
| WC-002 | Clipper templates, variables, filters and logic | N/A | [web-clipper/templates](https://obsidian.md/help/web-clipper/templates) | - | N/A: the clipper is an official browser extension, outside the notes app; web capture is out of scope. |
| WC-003 | Highlighter | N/A | [web-clipper/highlight](https://obsidian.md/help/web-clipper/highlight) | - | N/A: the clipper is an official browser extension, outside the notes app; web capture is out of scope. |
| WC-004 | Interpreter (AI prompts over a page) | N/A | [web-clipper/interpreter](https://obsidian.md/help/web-clipper/interpreter) | - | N/A: the clipper is an official browser extension, outside the notes app; web capture is out of scope. |
| WC-005 | Reader mode | N/A | [web-clipper/reader](https://obsidian.md/help/web-clipper/reader) | - | N/A: the clipper is an official browser extension, outside the notes app; web capture is out of scope. |

## Sync, publish and services

### External service

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| SY-001 | Obsidian Sync (managed sync, regions, plans) | N/A | [sync](https://obsidian.md/help/sync) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |
| SY-002 | Sync version history and deleted-file recovery | N/A | [sync/version-history](https://obsidian.md/help/sync/version-history) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |
| SY-003 | Selective sync and sync settings | N/A | [sync/settings](https://obsidian.md/help/sync/settings) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |
| SY-004 | Shared vaults (collaboration) | N/A | [sync/collaborate](https://obsidian.md/help/sync/collaborate) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |
| SY-005 | End-to-end encryption and sync security | N/A | [sync/security](https://obsidian.md/help/sync/security) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |
| SY-006 | Headless sync | N/A | [sync/headless](https://obsidian.md/help/sync/headless) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |
| SY-007 | Obsidian Publish (sites, permalinks, SEO, analytics, custom domains) | N/A | [publish](https://obsidian.md/help/publish) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |
| SY-008 | Publish collaboration, headless publish, media and limits | N/A | [publish/collaborate](https://obsidian.md/help/publish/collaborate) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |
| SY-009 | Obsidian Teams (licenses, deployment, security, sync, publish) | N/A | [teams](https://obsidian.md/help/teams) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |
| SY-010 | Account, 2FA, licenses, payment, refunds, discounts, catalyst | N/A | [2fa](https://obsidian.md/help/2fa) | - | N/A: separately provided paid service. Equivalent for sync is user-owned Git automation (P5); Git history covers SY-002 for Git workspaces. Pages for this category wer... |

## Mobile

### Mobile

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| MB-001 | Mobile apps (iOS, iPadOS, Android) | Partial | [mobile](https://obsidian.md/help/mobile) | - | Mobile shell works with open layout/keyboard bugs. |
| MB-002 | Mobile editing toolbar, quick action, navigation bar, widgets, share extension | Unverified | [mobile](https://obsidian.md/help/mobile) | - | Parity with Obsidian mobile UI features not verified (Help pages for iOS/Android/mobile read at heading level). |

## Onboarding and documentation

### Onboarding

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ON-001 | Sandbox vault / first-run guidance | Partial | [sandbox](https://obsidian.md/help/sandbox) | #144 | New workspaces open empty. |
| ON-002 | Built-in help and documentation | Partial | [resources](https://obsidian.md/help/resources) | - | No in-app help beyond the shortcut sheet. |

### Accessibility

| ID | Feature | Status | Source | Issue | Note |
|---|---|---|---|---|---|
| ON-003 | Accessibility documentation and features | Unverified | [settings](https://obsidian.md/help/settings) | #142 | Obsidian documents no accessibility features, so there is no baseline to compare; #142 is the app's own backlog. |
