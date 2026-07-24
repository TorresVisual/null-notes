# null-notes — Navigation & Organization Design

**Date:** 2026-07-24
**Scope:** Fourth of four planned polish passes (visual design system → ink toolbar & canvas polish → editor feel → **navigation & organization**). Removes a redundant search mechanism and fixes two workspace-switching bugs found while scoping this project.

---

## Goals

1. **Remove the redundant sidebar filter.** The sidebar has an inline "Filter by title…" text input that filters the folder tree client-side by title substring, alongside a separate `Ctrl+K` full-text search modal (SQLite FTS over note content). The inline filter is strictly weaker — everything it does, `Ctrl+K` already does, plus content search. Two inconsistent search mechanisms in the same sidebar is confusing; keep only `Ctrl+K`.
2. **Fix session-not-saved-on-workspace-switch.** `saveSession()` (persists `openTabs`/`activeTab`/`expandedFolders` to `.workspace.json`) is only ever called from a `beforeunload` listener in `Layout.tsx`. Calling `openWorkspace()` again to switch to a different workspace never calls it — the outgoing workspace's session state is silently lost unless the app happens to quit immediately afterward without switching again.
3. **Fix stale-tabs-on-workspace-switch.** `openWorkspace()` never resets `openTabs`, `activeTab`, `expandedFolders`, or `selectedFolder` before loading the new workspace's session. The old workspace's open tabs remain in the tab bar, now pointing at files that don't belong to the workspace you've switched into — mixed in with whatever tabs the new workspace's saved session restores.

Bugs 2 and 3 share the same root cause (workspace switching never resets state) and are fixed together in the same function.

## Non-Goals

- No change to how `beforeunload`-triggered session saving works — only the workspace-switch path gains a save call.
- No note-level rename/context-menu (explicitly deferred — title-from-heading is the existing, intentional design).
- No changes to the `Ctrl+K` search modal itself, tag list, backlinks panel, or folder tree beyond what's described above.

---

## 1. Remove the Inline Sidebar Filter

`src/components/Sidebar.tsx` changes:
- Remove the `search` state (`useState('')`) and its `<input>` element (`className="search-input"`, `placeholder="Filter by title…"`).
- Remove `visibleNotes` (the `search.trim() ? notes.filter(...) : notes` computation) — `tree` is built directly from `notes`: `buildFolderTree(workspacePath, folders, notes)`.

`src/index.css`: remove the now-unused `.search-input` rule (verified via search — no other file references this class; `.search-modal-input` in the `Ctrl+K` modal is a separate, distinct class and is untouched).

## 2 & 3. Fix Workspace Switching

New action on `WorkspaceStore` (`src/store/workspace.ts`):

```ts
resetForNewWorkspace: () => void
```

Resets `openTabs: []`, `activeTab: null`, `expandedFolders: []`, `selectedFolder: null`, `folderContextMenu: null`, `folderError: null`, `tagFilter: null` — i.e. every piece of per-workspace UI state back to its initial value.

`src/hooks/useWorkspace.ts`'s `openWorkspace()` is reordered:

```
1. Prompt for a directory (existing `open({ directory: true, ... })` call)
2. If a workspace was already open, save its session (existing saveSession() logic,
   now called here too, before anything else changes)
3. resetForNewWorkspace()
4. setPath(selected) — as today, this also sets selectedFolder to the new path
5. Load the new workspace's tree + session (existing scan/load logic, unchanged)
```

`saveSession` (already defined in the same hook) is moved above `openWorkspace` in the file so `openWorkspace` can reference it directly — no behavior change to `saveSession` itself, and its existing `beforeunload` wiring in `Layout.tsx` is untouched.

---

## File Structure

| File | Change |
|---|---|
| `src/components/Sidebar.tsx` | Remove inline filter state/input; build tree directly from `notes` |
| `src/index.css` | Remove unused `.search-input` rule |
| `src/store/workspace.ts` | Add `resetForNewWorkspace()` action |
| `src/store/workspace.test.ts` | Add test for `resetForNewWorkspace()` |
| `src/hooks/useWorkspace.ts` | Reorder `openWorkspace()` to save-then-reset before loading the new workspace |

No files are created or deleted.

---

## Testing

- `resetForNewWorkspace()` gets a unit test in `src/store/workspace.test.ts`, following the existing direct-store-call pattern already used by every other action in that file (populate several fields, call the action, assert they're back to initial values).
- `useWorkspace.ts`'s `openWorkspace()` itself has no existing test file (it's a thin orchestration hook around `@tauri-apps/plugin-dialog`'s file picker and Tauri IPC calls, neither of which is meaningfully unit-testable without a full Tauri runtime) — this pass follows that existing precedent rather than introducing new test infrastructure for it.
- `npm run typecheck` and the full `npm run test` suite after each change.
- Manual QA in `npm run tauri dev`: confirm the sidebar no longer shows a filter input (only the `Ctrl+K` search button remains); open workspace A, open a couple of tabs and expand a folder, switch to workspace B via "Open Workspace" — confirm workspace A's tabs don't appear in B's tab bar; switch back to workspace A — confirm its tabs and expanded folders are restored from the session that was just saved on the way out.

---

## Sequencing Note

This is project 4 of 4 in the "make the app awesome" polish effort. Projects 1-3 (visual design system, ink toolbar & canvas polish, editor feel) are complete and merged. This closes out the originally-scoped four-part roadmap.
