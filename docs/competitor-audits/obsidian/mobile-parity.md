# Obsidian mobile parity (MB-002)

Audited against [Obsidian mobile](https://obsidian.md/help/mobile) from the code (`MobileShell`, `MobileTabBar`, `MoreSheet`, `toolbarItems`, `ToolbarSettings`, `usePullDown`, `useEdgeSwipe`, `navigationHistory`), not from a running device. Tracked by #229. Widgets and the share extension were not audited.

First pass 2026-11-12 (before #240-#245), re-audit 2026-11-12 after #240-#245 landed (`6ac19cf`..`60bf02f`).

| Obsidian feature | First pass | Now | Evidence | Issue |
|---|---|---|---|---|
| Mobile toolbar above the keyboard | Partial | Have | `.editor-toolbar` fixed at `--keyboard-inset`, scrolls horizontally; `MobileToolbarItems` renders the registry | #244 |
| Toolbar: reorder, remove, add | Missing | Partial | Settings > Editor > Editing toolbar (`ToolbarSettings`): move up/down, hide, add back, reset. Obsidian lets you add any command; ours holds only the 22 editing items in `TOOLBAR_ITEMS`, and reorders by buttons, not drag | #244 |
| Toolbar: undo/redo, indent/outdent | Missing | Have | `undo`, `redo`, `indent`, `outdent` in `TOOLBAR_ITEMS` | #244 |
| Quick Action (pull-down runs a command) | Missing | Have | `usePullDown`; command chosen in Settings (`pullDownCommand`, default set, Off allowed). Active on Home and in the editor, not on the Notes tab | #242 |
| Command palette on mobile | Missing | Have | Top-bar button in the editor, More sheet entry, pull-down; desktop-only commands and key hints hidden in `CommandPalette` | #240 |
| Nav bar: back | Partial | Have | Top-bar back steps note history, then closes the editor; system Back follows the same order (`previous-note` in `backNavigation.ts`) | #241 |
| Nav bar: forward | Missing | Have | Top-bar forward, shown only when there is something to go forward to | #241 |
| Nav bar: plus for new note or quick switcher | Partial | Partial | FAB creates a note (Home/Notes only). Quick switcher is a separate button, in the editor top bar and the More sheet. Not one control, not on the FAB | #240 |
| Nav bar: tab counter and switcher | Missing | N/A | Decided against, recorded in `docs/specs/mobile-native-shell-design.md`; history, quick switcher and the Notes/Search tabs cover it | #243 |
| Nav bar: menu standing in for the ribbon | Have | Have | More sheet | - |
| Sidebars: gesture to open | Missing | Partial | Right-edge swipe or top-bar button opens `NoteOutlineSheet` (outline and backlinks). No left file sidebar; browsing is the Notes tab | #245 |

## Open points

None of these has an issue yet.

- Toolbar cannot hold arbitrary app commands (palette actions), only editing items.
- Reordering is up/down buttons, not drag.
- The editor top bar can now hold back, forward, title, save status, outline, quick switcher and palette. Not checked at 360 px width.
- Toolbar buttons use a 15 px icon; the 44 px target size was not checked for the editor toolbar itself (only the settings rows set it).
- Pull-down is not wired on the Notes tab.
- The gestures are covered by unit tests (`useEdgeSwipe.test.ts`, `MobileShell.test.tsx`, `mobileToolbar.test.tsx`); none was exercised on a device.
