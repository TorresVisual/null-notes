# Workspace dashboard (P9-4)

## Problem

The app always opens to whatever note was active when it last closed, and there's no view of the workspace as a whole — what's open, what's recently changed, what's outstanding — short of walking the sidebar. P9-4 is a capstone: a single home screen assembled entirely from data P1, P5 and P9-1 already track, with nothing new derived or persisted for this task. P9-3 (spaced repetition) isn't built yet, so the Study section this task's own DoD calls for ships as a disabled placeholder and gets wired up when P9-3 lands.

## Where Home lives

Home is not a new overlay. `Layout.tsx`'s main pane already branches on `!activeTab`: today that branch renders a one-line "select a note" message while `workspacePath` and `notes` decide the exact wording. This task widens that same branch to render `<HomeView />` instead, and nothing else about the branch's trigger changes — a workspace that restores with no open tabs (a fresh workspace, or one that was closed with none open) already lands on `activeTab === null`, so it shows Home for free.

**The explicit "Home" command doesn't add a view-state flag.** It just clears the active tab: a new `home` case in `Layout.tsx`'s `runCommand` calls `setActiveTab(null)`. Open tabs stay exactly as they are in the tab bar — nothing closes — and `TabBar` already renders correctly with `activeTab === null` (no tab highlighted, the save-status/view-toggle cluster hidden), which is the same state a workspace with zero tabs is already in today. Opening any note — clicking a tab, a Home item, the quick-switcher — already sets `activeTab` through existing code, so leaving Home again needs no explicit "close" step.

This requires widening `WorkspaceStore.setActiveTab`'s signature from `(notePath: string) => void` to `(notePath: string | null) => void`. No other store shape changes.

## Sections

Every section reads state that's already tracked somewhere in the app; none of them add a store field, a database table, or a new Tauri command.

**Continue** — `openTabs` from `useWorkspaceStore`, capped at 5, most-recently-opened first (`[...openTabs].reverse().slice(0, 5)`). This is the same array `.workspace.json` already persists and `openWorkspaceAt` already restores. Clicking an item calls `setActiveTab(path)` (it's already open, matching a tab-bar click).

**Recent** — `useNotesStore().notes`, sorted by `updatedAt` descending, capped at 5. No dedup against Continue — the same note can legitimately appear in both, and filtering it out of one list would make that list quietly resize itself while an editor tab still shows it as open. Clicking an item calls `openTab(path)` (mirrors clicking a note anywhere else in the app: opens it if not already a tab, activates it if it is).

**Tasks** — `api.notes.listOpenTasks(workspacePath)`, the same call `TaskView` already makes on mount. Shows an open-task count and up to 5 individual tasks (note title + task text, truncated); clicking one opens its note via `openTab` (mirrors `TaskView.openNote`, minus the `onClose` — Home isn't a modal). A "View all" affordance opens the existing `TaskView` modal (`setTaskViewOpen(true)`, already wired in `Layout`).

**Study** — a static disabled card: "Spaced repetition isn't set up yet." No data fetch, no store read. Replaced with real due-card data as part of P9-3, not before.

**Git** — derived entirely from fields `useWorkspaceStore` already holds live, no new IPC call:
- `repoMode === null` → section not rendered (not a Git workspace).
- `gitDiverged` set → "N ahead, M behind" (same wording `GitDivergedBar` already uses).
- else `gitPendingPaths.length > 0` → "N unpushed" (paths saved since the last auto-commit that haven't gone through `checked_auto_commit` yet).
- else → "Up to date".

Non-interactive: there's no dedicated Git panel to link to today (`GitDivergedBar` and `TabBar`'s `GitCommitStatus` are indicators, not links), so this tile is display-only.

## Component

`src/components/HomeView.tsx`. Plain layout following `TaskView`'s data-fetch shape (a `useEffect` keyed on `workspacePath` for the Tasks fetch) but no overlay chrome — it renders inline inside the existing `editor-pane` slot, not as a `.search-overlay` modal, since it's the main pane's own content rather than something dismissible on top of a note.

## UI

- **View menu**, alongside the other view toggles: `Home`, accelerator `Ctrl+H`. New `MenuItem` in `src-tauri/src/lib.rs`'s `build_menu`; new `home` case in `Layout.tsx`'s `runCommand` switch (`setActiveTab(null)`).
- `ShortcutsOverlay` gains a `Ctrl H — Home` row.
- No new keyboard shortcut collides with an existing one (`Ctrl+H` is unused today).

## Testing

- `HomeView` unit tests (Vitest + RTL): each section renders from store/mock-API state; clicking a Continue/Recent/Task item calls the right store action; Git section text matches each of the three derived states; Study renders as disabled with no fetch attempted.
- `store/workspace.test.ts` gains a case for `setActiveTab(null)`.
- E2E (per `.claude/skills/e2e-verify/`): a workspace opened with no tabs restored lands on Home; the `Ctrl+H` menu command (via the existing `__e2eRunCommand` hook, since native menu clicks aren't reachable from WebDriver) clears the active tab without closing open tabs; clicking a Continue/Recent item opens the note and leaves Home.

## Out of scope

- **Any new derived state or backend query.** Every section is a read of data another phase already computes and stores; this task adds zero database columns, zero Tauri commands, zero background jobs.
- **The Study section's real data.** Ships disabled; P9-3 fills it in.
- **A dedicated Git panel.** The Git tile stays a status readout; building an actual Git view is not part of this task's scope.
- **Reordering or pinning dashboard sections.** Fixed order (Continue, Recent, Tasks, Study, Git), no per-user customization.
