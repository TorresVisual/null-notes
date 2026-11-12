# Obsidian mobile parity (MB-002)

Audited 2026-11-12 against [Obsidian mobile](https://obsidian.md/help/mobile), from the code (`MobileShell`, `MobileTabBar`, `MoreSheet`, `EditorToolbar`, mobile CSS, `navigationHistory`), not from a running device. Tracked by #229. Widgets and the share extension were not audited.

| Obsidian feature | Status | Evidence | Issue |
|---|---|---|---|
| Mobile toolbar above the keyboard | Partial | `.editor-toolbar` is fixed at `--keyboard-inset` and scrolls horizontally; it is the desktop text-format and insert groups, `SheetGroup` hidden | #244 |
| Toolbar: reorder, remove, add any command | Missing | Items hard-coded in `TextFormatGroup` / `InsertGroup` | #244 |
| Toolbar: undo/redo, indent/outdent | Missing | No undo/redo in `TextFormatGroup`; indent/outdent not checked | #244 |
| Quick Action (pull-down runs a command) | Missing | Only touch handler is `useLongPress.ts` | #242 |
| Command palette on mobile | Missing | `CommandPalette.tsx` has no entry point in `MobileShell` | #240 |
| Nav bar: back | Partial | Editor top bar closes the editor; no history stepping | #241 |
| Nav bar: forward / history | Missing | `navigationHistory.ts` only wired into desktop `Layout` / `TabBar` | #241 |
| Nav bar: plus for new note or quick switcher | Partial | FAB creates a note, hidden while editing; `QuickSwitcher` unreachable | #240 |
| Nav bar: tab counter and switcher | Missing | Single `activeTab`, no tab UI (open decision) | #243 |
| Nav bar: menu standing in for the ribbon | Have | More sheet: Review, Deck, Tasks, Graph, Formula sheet, Settings, Sync now | - |
| Sidebars: gesture to open | Missing | Bottom tab bar navigation; outline and backlinks unreachable from the editor | #245 |
