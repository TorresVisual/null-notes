# Editor groups (#235)

Supersedes the pane model in [split-pane-editing-design.md](split-pane-editing-design.md) (#54).

## Intent

Split editing today is one right-hand pane reachable only by dragging a tab to the right edge. The second pane is a pointer (`secondaryTab`) into the single shared tab list, so each side can't hold its own tabs, nothing tracks focus, and the split can't be driven from the keyboard. The goal is VS Code's editor-group model, limited to two groups: split by command, menu or drag onto any edge; each group has its own tabs; focus follows clicks and keyboard commands; the layout survives a restart.

## Goals

- Split the active tab with a command, a tab context-menu item, and a drop on any of the four edges of the editor body.
- Two groups maximum, arranged as a row (side by side) or a column (stacked).
- Each group has its own tab bar, tab list, pinned tabs, active tab and Source/Preview mode.
- A note may be open in both groups at once, backed by **one shared live buffer**.
- One focused group. It follows the last click or focus, and keyboard commands move it.
- Divider: double-click resets to 50/50; keyboard-resizable.
- Both groups get the same side panels (Outline, Outgoing Links, Backlinks, History).
- Layout (direction, ratio, each group's tabs/active/mode, focused group) persists per workspace.

## Non-goals

- More than two groups, or nested/grid layouts. Chosen by the user: "I wouldn't use more than 2 panes."
- Chord shortcuts (`Ctrl+K Ctrl+…`); the keymap has no chord support.
- Floating or separate OS windows.
- Fixing `useInkStore.activeCanvasId` being a single global slot (known limitation from #54; unchanged, and a note open in both groups makes interrupted ink edits somewhat likelier).

## Anti-goals

- Silently losing or corrupting a note. Two groups on one note must never be two independent buffers; the save-path rules in CLAUDE.md ("The save path") stay intact, including `write_atomic`, the watcher-echo check and never overwriting a dirty buffer from disk.
- A false conflict prompt caused by typing in the other group.

## Constraints

- `save_note` still does no DB work; `reindex_note` stays on its slower debounce.
- Workspace-resident state must merge across machines; layout lives in `.workspace.json` (UI state, gitignored), alongside `canvasViewports`. No new storage location.
- Canvas (`.canvas`) and Bases (`.base`) tabs are not `useNote`-backed and keep their own state. They keep #54's restriction: they cannot be split into or moved to the second group.
- `src/lib/skills.test.ts` and the plugin in `skills/` cover the CLI/Markdown dialect, not the UI; no skill update is needed.
- Keymap: see "Shortcuts".

## Approaches

**Shared buffer between groups**
- *A. Path-keyed note-buffer store (chosen).* The buffer, save/reindex timers, conflict state, `recentWrites` and the `workspace-changed` listener move from `useNote`'s per-component state into a module-level store keyed by note path with a reference count. `useNote(path)` becomes a subscriber. One writer, one debounce, one conflict prompt per file; the buffer is flushed and released when the last group drops the path. Larger refactor, but makes "one buffer per file" structurally true.
- *B. Dedupe in `Layout`.* Keep two `useNote` slots; when both groups show the same path the second reuses the first's result. Small diff, but when one group leaves the note its cleanup flush is async and the other group's fresh `open()` can read stale disk content. Rejected.
- *Disallow duplicates* (opening a note already in the other group focuses it) was offered and declined in favour of shared buffers.

**Layout model.** Two groups cap the layout at `{ direction, ratio, groups: [A, B] }`, so no tree is built. A top/left drop puts the new group first, bottom/right second.

## Design

### Note buffers

`src/store/noteBuffers.ts` (name is the builder's call) owns, per path: content, `loadedPath`/failed state, `saveState`, `saveError`, `conflict`, the pending write/index jobs and timers, the `recentWrites` ring, and `incoming` (held external content). `acquire(path)` loads on first use and starts the single `workspace-changed` listener; `release(path)` flushes and runs the asset GC (today's cleanup effect) on the last release. `useNote(path)` keeps its current return shape so `EditorPane` props don't change. All existing `useNote` behaviour is preserved, in particular: `save()` ignoring writes until the path has loaded, failed opens leaving the buffer empty and refusing saves, the dirty-path reporting, and `beforeunload` flushing (now a flush of every buffer). The `close-requested` handler flushes every buffer rather than two named `flush` functions.

Both groups' editors render from the same `content`. When one group's `NoteEditor` emits a change, the other receives the new `content` and must update its document without disturbing the focused group's selection or undo history. How `NoteEditor` currently applies a changed `content` prop (the reload-theirs path already does) is the thing to verify first.

### Group model

`useWorkspaceStore` replaces `secondaryTab`/`splitRatio` with:

```ts
interface EditorGroup { tabs: string[]; pinned: string[]; active: string | null; viewMode: ViewMode }
groups: EditorGroup[]            // length 1 or 2
focusedGroup: number             // index into groups
splitDirection: 'row' | 'column'
splitRatio: number               // first group's share, 0.2..0.8
```

Invariants carry over from today (pinned ⊆ tabs, pinned tabs are a prefix). `closedTabs` stays a single LIFO stack; reopening goes to the focused group. Whether the legacy top-level `openTabs`/`pinnedTabs`/`activeTab` stay as derived accessors for the focused group or every caller moves to group selectors is the builder's call, provided there is exactly one source of truth.

Behaviour:

- **Open a note** (sidebar, links, search, quick switcher) opens or activates it in the focused group. Canvas/base paths open in group 0 and focus it.
- **Split** (command / menu / context menu / drop) copies the source tab into a new group on the chosen side and focuses it. Splitting from a one-tab group leaves that note in both groups (shared buffer). If two groups already exist, split is a no-op; edge drops move the tab into the group nearest that edge.
- **Drop onto a group's body or tab bar** moves the tab there (copies when Ctrl is held, as in VS Code). Moving a group's last tab away closes that group.
- **Closing a group's last tab** closes the group (VS Code's `closeEmptyGroups` default). With one group and no tabs, Home shows as today.
- **Close group** command closes the focused group, discarding its tab list; the notes stay open in the other group if they were there, otherwise they are closed with the same flush as a normal tab close and are pushed on `closedTabs`.
- **Rename/delete** (`replaceOpenPath`, `closeTabsUnder`) apply to all groups.
- **Edge drops with two groups.** Edge zones only exist while there is one group. With two, each group's body and tab bar is a drop target that moves the tab in; a drop never changes `splitDirection` or order. A `toggle-split-direction` command (no default key) switches row/column, keeping group order. *(Builder-check call.)*
- **Source/Preview mode** belongs to the group and is persisted. It is no longer reset to Preview when the active tab changes (today's `Layout` effect on `activeTab` is removed), because "remembers its own mode" and the reset contradict each other. `Ctrl+E` toggles the focused group; export/print force Preview on the focused group only. *(Builder-check call.)*
- **Back/forward** (`navigationHistory.ts`) stays one global stack. Going back/forward opens the path in the focused group (activating it if already there), and the existing "goBack is switching the tab" suppression applies to whichever group changes. *(Builder-check call.)*
- **Focus** is set by mousedown/focus within a group; the tab-bar actions below act on the focused group: Ctrl+1..9, next/prev tab, close tab, reopen, Ctrl+E (source/preview), nav back/forward, window title, and the terminal's `notePath`.
- Dragging a tab within a group's strip reorders (existing behaviour, per group).

### UI

- `TabBar` becomes per-group (props: group index). The save-status chip, git status and sync controls render in the first group's bar only (stable position). That chip shows the save state of the focused group's active note.
- `EditorPane` (already extracted) is rendered per group with that group's active note. Outline and Outgoing Links move inside the per-group wrapper; their open/closed toggles remain global and apply to both.
- Editor body is a flex row/column of two `pane-wrapper`s with the divider between. The divider is a focusable `role="separator"`: arrow keys resize by 5% (clamped 20–80%), Home/End jump to the limits, double-click resets to 0.5; mouse drag as today, using the Y axis for a column.
- Drop zones: while a tab is dragged, the editor body shows four edge zones (outer 25%) with a highlight overlay, plus a "center" zone per existing group. Replaces `handleEditorDragOver`/`handleEditorDrop`.
- Tab context menu gains Split Right/Left/Up/Down (disabled for canvas/base tabs and when two groups exist). `Layout.tsx` is already 963 lines; the group layout, divider and drop-zone logic go into their own component and hooks rather than growing it further (`useNote` calls leave `Layout` entirely).

### Shortcuts

All commands are added to `src/lib/keymap.ts` (rebindable, shown in the shortcuts help and command palette):

| Command | Default |
|---|---|
| `split-editor` (Split Right, or Down in a column) | `Ctrl+\` |
| `split-editor-down` | none |
| `focus-next-group` / `focus-prev-group` | `Ctrl+Alt+ArrowRight` / `Ctrl+Alt+ArrowLeft` |
| `close-editor-group` | none |
| `reset-split-ratio` | none |
| `toggle-split-direction` | none |
| `toggle-sidebar` (moved) | `Ctrl+Shift+B` |

`Ctrl+\` is currently `toggle-sidebar`, not the terminal (the issue misreads this: the terminal is `Ctrl+\``, which is untouched). The sidebar toggle moves to `Ctrl+Shift+B`. Any user override of `toggle-sidebar` is left alone. VS Code's `Ctrl+1`/`Ctrl+2` group focus is not mirrored because those keys already switch tabs.

### Persistence

`WorkspaceState` (`src/types/index.ts`) and its Rust mirror (`src-tauri/src/models.rs`) replace `secondaryTab`/`splitRatio` with the group layout, all `#[serde(default)]` like `git`. Reading a file that has the old fields (or only `openTabs`/`activeTab`) must yield an equivalent layout: group 0 = the old tab list, and a second group from the old `secondaryTab` as a row split at the old ratio. `useWorkspace.ts` and `useGitConfig.ts` (which both rebuild `WorkspaceState` from the store) are updated together. Restored groups drop paths that no longer exist, and a layout that ends up with an empty second group collapses to one group.

## Phasing

One commit per phase, each leaving the app working:

1. Note-buffer store; `useNote` becomes a subscriber. No visible change. Tests: two subscribers on one path, own-write echo with two subscribers (no false conflict), last-release flush, failed open.
2. Group model in the store, with persistence and migration, and `Layout` driving the same two panes from it.
3. Per-group `TabBar`, focused group, divider behaviour, per-group side panels and modes.
4. Four-edge drops, split commands and menu items, keymap changes and shortcut docs.

## Testing

- Store logic (groups, close/rename/focus/split rules, migration of old `.workspace.json`) as unit tests in the style of `workspace.test.ts`.
- Rust round-trip of the new `WorkspaceState` fields and of a legacy file.
- Key behaviour tested through the real `editorProps` where editors are mounted.
- `e2e-verify` for drag-to-edge, keyboard split/focus, shared editing across groups and restart persistence of the layout.

## Docs

`docs/ROADMAP.md` (split-pane row and the `Ctrl+\` line), the in-app shortcuts help, and the #54 design (marked superseded).

## Left to the builder

- Name and exact shape of the buffer store and whether legacy tab accessors stay derived.
- Exact visual styling of drop zones and the focused-group indicator, kept on existing tokens and `index.css` classes (grep for each className introduced).
- How `NoteEditor` applies external content updates to the unfocused group.
