# Split-pane editing (#54)

> **Superseded by [editor-groups-design.md](editor-groups-design.md) (#235).** The single `secondaryTab` pointer described here was replaced by two editor groups, each with its own tabs.

## Problem

`docs/ROADMAP.md:1299` deferred split-pane editing to "reconsider at P4," naming the deciding case explicitly: a PDF-imported exercise sheet on one side, its worked solution on the other. P4 shipped and froze without ever revisiting that decision — the roadmap row is still ❌ Missing. The workflow it named is now real and in daily use, and today it costs constant tab-switching in the single editor pane (`TabBar.tsx`/`Layout.tsx`), losing sight of the exercise while writing the solution.

Scope, per the issue and follow-up discussion: drag a second tab to the right edge of the editor to open two notes side by side in the existing window. Not a new OS window, not a general N-pane grid — exactly two panes, no nesting. Each pane gets its own WYSIWYG/raw toggle (the raw view already exists as a full-pane replacement, `RawEditor.tsx`; making it per-pane rather than per-tab is a small extension of something that already works). Same-note dual view (rendered + source of *one* note, sharing a buffer) is a related but different feature — out of scope here, left as a possible follow-up.

## Architecture

The single-pane rendering block already inline in `Layout.tsx:612-674` (loading state, `NoteEditor`/`RawEditor` swap, empty states, `BacklinksPanel`, `NoteHistoryPanel`, `OutlinePanel`) becomes a new component, `EditorPane`, parameterized by `notePath` and `viewMode`. `Layout` renders one `EditorPane` today; with a `secondaryTab` set, it renders two side by side with a drag-resizable divider between them.

```
Layout.tsx
 ├─ editor-body
 │   ├─ EditorPane (primary: activeTab, primaryViewMode)
 │   ├─ <PaneDivider>            (only when secondaryTab is set)
 │   └─ EditorPane (secondary: secondaryTab, secondaryViewMode)
 └─ OutlinePanel                  (always keyed to activeTab, not per-pane)
```

`EditorPane` is presentational, not a data source: `Layout` keeps calling `useNote` itself — once for `activeTab` (as today) and once more for `secondaryTab` — and passes the result (`content`, `save`, `isLoading`, `saveState`, `conflict`, `keepMine`, `reloadTheirs`, …) into each `EditorPane` as props, the same values it already destructures today. This is a correction from the first cut of this design, which had `EditorPane` call `useNote` internally — that would strand each pane's `flush()` inside the component, unreachable from the `close-requested` handler (`Layout.tsx:135-147`) that must flush *every* pending write before the window is allowed to close. Keeping both `useNote` calls in `Layout` means that handler calls both panes' `flush()`, exactly as it calls the one today. `NoteEditor` itself is still a plain per-path component (`NoteEditor.tsx:42` takes `notePath` as a prop, no module-level singleton), so mounting two is otherwise unaffected. `ConflictBar` (`Layout.tsx:569`, currently a single app-level bar) moves inside `EditorPane` alongside `BacklinksPanel`/`NoteHistoryPanel` — each pane surfaces a conflict for *its own* note rather than one bar assuming there's only ever one open note. `OutlinePanel` and `PdfPageBlock` export/print stay wired to the primary pane only — building a second "focused pane" concept for side panels isn't justified by the driving use case (exercise sheet + solution, where the outline of interest is the solution note being written).

`editorPaneRef` (`Layout.tsx:117`) currently refs the one container div and is read by `OutlinePanel`'s scroll-linking and by PDF export/print (`Layout.tsx:504,507`). It moves to be the primary `EditorPane`'s own ref, exposed via a forwarded ref or an `onMount` callback — those three consumers stay pointed at the primary pane's DOM subtree specifically, not the outer two-pane wrapper.

## State

`useWorkspaceStore` (`src/store/workspace.ts:25`) gains two fields next to `activeTab`:

```ts
secondaryTab: string | null   // null = single-pane (today's behavior)
splitRatio: number            // 0..1, primary pane's width fraction; default 0.5
```

No second `openTabs` list — the tab bar stays one shared strip (`TabBar.tsx`), and `secondaryTab` is just a pointer into the same `openTabs` array, added to it if not already present when a split is created. View mode becomes per-pane state owned by `Layout` (`primaryViewMode`/`secondaryViewMode`, replacing the single `viewMode` at `Layout.tsx:114`) rather than store state — it's ephemeral UI state today (not persisted) and stays that way for both panes.

Every existing `openTabs` mutation that already accounts for `activeTab` needs the same handling for `secondaryTab`:

- `closeTab` (`workspace.ts:143`): if the closed path is `secondaryTab`, clear it to `null` (no "pick a neighbor" fallback — closing the note you're viewing in the second pane should collapse back to single-pane, not silently load some other tab into it).
- `closeTabsUnder` (`workspace.ts:202`, folder delete/rename): same clear-if-affected check.
- the path-prefix rename handler (`workspace.ts:193`): `secondaryTab` needs the same `replacePathPrefix` applied that `activeTab` gets.
- `reorderTabs` (`workspace.ts:162`): unaffected — it only reorders `openTabs`, doesn't touch which paths are "active."

New action: `setSecondaryTab(path: string | null)`, used by both the drop handler and each pane's close button.

## Interaction

- **Tab bar clicks are unchanged** — always target the primary pane (`setActiveTab`, `TabBar.tsx:68`). No "click a tab while pane B is focused" ambiguity to design around, because there's no per-pane focus concept.
- **Drag-to-split**: `TabBar.tsx` already tracks `draggedPath` via native HTML5 `draggable`/`onDragStart` (`TabBar.tsx:40,59`) for tab reordering. The editor area (`editor-pane`, `Layout.tsx:614`) gains its own `onDragOver`/`onDrop` handlers active only while a tab drag is in progress (checked via the same `draggedPath`, lifted into the store or passed down, since drag state currently lives in `TabBar`'s local `useState`). Dragging over the right ~25% of the editor area shows a highlighted drop-zone overlay (absolutely positioned `div`, no new dependency); dropping there calls `setSecondaryTab(draggedPath)`, adding the path to `openTabs` first if needed (mirrors `setActiveTab`'s add-if-missing check at `workspace.ts:135`).
- **Replacing the secondary pane**: dropping a different tab on the same right-edge zone just calls `setSecondaryTab(newPath)` again — no third pane, per the "exactly 2, no nesting" decision.
- **Closing a pane**: each `EditorPane` header gets a small `×`. On the secondary pane this calls `setSecondaryTab(null)` (collapses to single-pane; the note stays open in the shared tab strip). The primary pane's `×` isn't new — closing the active tab already exists via the tab bar itself.
- **Per-pane view toggle**: the existing "Source/Preview" button (`TabBar.tsx:104`) stays in the shared tab bar and controls the primary pane only (`primaryViewMode`), since it's rendered once regardless of split state. The secondary pane gets its own small toggle in its own header — same button, same labels, wired to `secondaryViewMode`.
- **Resizing**: a 4px divider between the two `EditorPane`s. Plain `onMouseDown` → `window` `mousemove`/`mouseup` listeners computing the fraction from cursor X over the container width, clamped to e.g. [0.2, 0.8], written to `splitRatio`. No resizable-pane library — this is one draggable divider, not a general layout system.

## Persistence

`WorkspaceState` (`src/types/index.ts:52`) gains:

```ts
export interface WorkspaceState {
  openTabs: string[]
  activeTab: string | null
  secondaryTab?: string | null
  splitRatio?: number
  expandedFolders: string[]
  recentSearches: string[]
  git: GitWorkspaceConfig
}
```

Rust mirror (`src-tauri/src/models.rs:97`) follows the exact pattern already used for `git` at `models.rs:114` — added after `.workspace.json` shipped, so it must tolerate its own absence in a file an older build wrote:

```rust
#[serde(default)]
pub secondary_tab: Option<String>,
#[serde(default)]
pub split_ratio: Option<f64>,
```

`None`/absent `split_ratio` means "use the default 0.5" on the frontend — no need for a Rust-side default value, since the frontend already has to handle "no split at all" (`secondary_tab: None`) the same way. Load/save paths (`load_workspace_from_dir`/`save_workspace_to_dir`, `commands/workspace.rs:9-18`) need no changes — they already round-trip the whole struct.

## Known limitation (not fixed here)

`useInkStore`'s `activeCanvasId` (`src/store/ink.ts:51`) is a single global slot, cleared on any editor's selection change (`NoteEditor.tsx:125`). With two `NoteEditor` instances mounted, drawing in one pane's ink canvas can be interrupted by a selection change in the other pane. The driving use case (PDF exercise sheet + text solution) doesn't call for simultaneous ink editing in both panes, so this is recorded as a follow-up rather than scoped into this change. If it turns out to bite in practice, the fix is scoping `activeCanvasId` per pane rather than per app.

## Testing

- Store logic (`closeTab`/`closeTabsUnder`/rename clearing `secondaryTab`, `setSecondaryTab` add-if-missing) gets unit tests in the existing `workspace.test.ts` shape.
- `EditorPane` extraction is a refactor of existing, already-tested rendering logic — no new behavior to unit-test beyond wiring.
- Drag-to-split, the divider drag, and the two-pane layout are interaction/visual behavior best covered by `e2e-verify` (per the skill already in this repo): drag a tab to the right edge, confirm two notes render side by side, confirm closing the secondary pane collapses back to single-pane. Persistence itself is covered at the unit level instead — the Rust roundtrip test and a hook test asserting `openWorkspaceAt` restores `secondaryTab`/`splitRatio` into the store — since no existing e2e spec in this repo drives a real app relaunch to check session persistence (not even for `openTabs`), and inventing that infrastructure for this one field isn't justified by this change.

## Out of scope

- **Same-note dual view** (rendered + raw of one note sharing a buffer). Different interaction shape (one buffer, two views) — a possible follow-up, not this change.
- **More than 2 panes, or nested splits.** Explicitly rejected — matches the issue's actual ask.
- **Per-pane focus tracking for side panels** (Outline/Backlinks/History). These stay keyed to the primary pane.
- **Independent tab strips per pane.** One shared strip; a pane is just a second pointer into it.
