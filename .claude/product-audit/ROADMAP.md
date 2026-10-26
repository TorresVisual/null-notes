# Product Opportunities

## Foundation

### Deleted notes/folders are unrecoverable
Status: issue created
Issue: #121
Evidence: notes.rs:1635 `remove_file` + sidecar `remove_dir_all`; TreeNode.tsx:74,198 confirm only ("This cannot be undone"). Ink drawings live in sidecars; uncommitted ones vanish. Git history panel only works for notes that still exist.
Shape: move to workspace-local `.trash/` (gitignored? decide - storage-boundary column) or OS recycle bin; restore from tree/undo toast.

### Same-titled notes collide in wiki-links and rename
Status: issue created
Issue: #122
Evidence: WikiLink.tsx:30 first-title match; notes.rs rename_note_at rewrites every `[[old title]]` in workspace via backlinks_for(title); ROADMAP §2 risk 5 called duplicate titles "acceptable" before multi-course monorepos and PDF imports (sheet names repeat per course).
Shape: path-qualified links `[[Course/Sheet 01]]` on collision, disambiguating picker, rename scoped to the links that resolved to that note.

## Core Editing

### Note transclusion / embed
Status: candidate, low priority (not on roadmap)

## Study Workflow

### Markdown -> .tex export
Status: tracked in docs/ROADMAP.md P18 (unscoped); no issue filed

## Workspace & Sync

(none new)

## Advanced

(none)

## Polish

### Light theme
Status: deliberately deferred (docs/specs/visual-design-system-design.md); do not file.

## Added in second run (2026-10-22)

### Natural-order sort for numbered notes
Status: issue created
Issue: #123 (Core Editing)

### Sidebar multi-select (bulk move/delete)
Status: issue created
Issue: #124 (Core Editing)

### Considered and skipped
Pinned notes (Home Recent + quick switcher cover it); multi-note export (overlaps #68 / P18); frontmatter (query blocks cut).

## Added in third run (2026-10-22, study area)

### Review keyboard shortcuts + undo last grade
Status: issue created
Issue: #125 (Study Workflow)

### Daily new-card cap
Status: issue created
Issue: #126 (Study Workflow)

## Added in fourth run (2026-10-22)

### Sidecar GC for ink/diagram/pdf files
Status: issue created
Issue: #127 (Workspace & Sync)

### Jump from a card to its line in the note
Status: issue created
Issue: #128 (Study Workflow)

## Added from competitive gap analysis (2026-10-26)

Report: docs/competitive-gap-analysis-2026-10-26.md

- #135 Single-file Explorer open edits a temp copy (Workspace & Sync, bug/high)
- #136 Action palette Ctrl+Shift+P (Core Editing)
- #137 FSRS opt-in scheduler (Study Workflow; gated on review-log storage decision, with #67)
- Not filed (candidates): saved searches, export bundle/Pandoc (with #68, P18), P15-1 recognizer spike, note embeds
