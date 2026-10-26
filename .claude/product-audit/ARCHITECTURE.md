# null-notes Architecture

(Authoritative: root CLAUDE.md, src-tauri/src/pdf/CLAUDE.md, src-tauri/src/commands/CLAUDE.md. This is a digest.)

## Editor (TipTap extensions, markdown round-trip)
TipTap 3 / ProseMirror. One file per node in src/editor/extensions/. Markdown via tiptap-markdown; each node carries its own addStorage().markdown serialize/parse. Wiki-links are `[[Title]]` nodes (WikiLink.tsx) resolved on the frontend by `notes.find(title.toLowerCase())` - first match wins.

## Save path & storage boundary
Autosave debounced -> save_note (atomic write: temp+fsync+rename; no DB work) -> reindex_note on slower debounce. Watcher echoes own writes; dirty buffer never overwritten. Inside workspace: .md, NoteName.{ink,pdf,diagrams,assets}/ sidecars, .workspace.json. OS app-data: index.db, settings.json, recent-workspaces.json (rebuildable).
Delete (notes.rs delete_note_at): permanent `remove_file` + `remove_dir_all` on all four sidecars. UI confirm only (TreeNode.tsx). No trash.

## Search / index (SQLite)
db/{mod,notes,schema}.rs. FTS over note text + PDF-page text + diagram labels. note_links(target_title COLLATE NOCASE) - links keyed by title only. scan_workspace upserts note metadata; reindex_from_disk rebuilds content.

## Ink & diagrams
Canvas + perfect-freehand, SVG sidecars in NoteName.ink/. Excalidraw-backed DiagramBlock in NoteName.diagrams/. Mermaid blocks + template gallery.

## PDF pipeline (frozen)
Text-layer extraction, no OCR, pdfium. Bugs go via pdf-bug-triager. Surrounding UI only is auditable.

## Git automation
commands/git.rs (+ git_mobile.rs via gix). Batched auto-commit, ff-only auto-pull, ahead/diverged/pull-blocked bars, clone dialog, serialized git ops. Deleted dirs/sidecars are staged by auto-commit (#111).

## Terminal / code execution / IDE links
terminal.rs PTY pane; code_run.rs (Python, C/C++; Java open #105); editor_launch.rs; code deep links with drift detection.

## Study (spaced repetition, tasks, formula sheet, dashboard)
sm2.rs; inline cards `front :: back`, cloze, image + diagram cards, suspend, cram mode; task view (workspace-wide); formula sheet generation (folder/tag); HomeView dashboard.

## AI
Gated stretch (docs/ROADMAP.md P10-1); not a roadmap centre.

## Important Entry Points
src/components/Layout.tsx, EditorPane.tsx, src/editor/NoteEditor.tsx, src/store/workspace.ts, src-tauri/src/lib.rs, commands/notes.rs (~4700 lines, incl. tests).

## Important Services
commands/watcher.rs (external change), commands/git.rs, db/, sm2.rs, exercises.rs (exercise splitter).

## Known Architectural Constraints
- Note identity = path; title is the link key (ROADMAP §2 risk 5, "acceptable" - revisit for multi-course).
- Out of scope: ROADMAP §7. Frozen PDF pipeline. Merge-conflict resolution out of scope.
- Mobile (P16) and web (P17) shells exist/in progress; desktop-primary.
