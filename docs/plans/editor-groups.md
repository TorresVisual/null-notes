# Editor Groups Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the single secondary pane with up to two VS Code-style editor groups, each with its own tabs, sharing one live buffer per open note.

**Architecture:** Note buffers move out of `useNote`'s per-component state into a path-keyed, ref-counted store; `useNote(path)` becomes a subscriber. Layout state becomes pure reducers in `src/lib/editorGroups.ts` driven by `useWorkspaceStore`, which keeps `openTabs`/`pinnedTabs`/`activeTab` as a projection of the focused group so the ~147 existing usages keep working. The UI becomes a two-slot container of per-group tab bar + `EditorPane`.

**Tech Stack:** React 19, TypeScript strict, Zustand, TipTap 3, Vitest, Tauri 2 / Rust (serde).

**Spec:** [docs/specs/editor-groups-design.md](../specs/editor-groups-design.md)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- At most 2 groups; layout is `{ groups, focused, direction: 'row' | 'column', ratio }`. Ratio clamped to 0.2–0.8; keyboard resize step 0.05; double-click resets 0.5.
- One live buffer per note path, shared by every group showing it. `write_atomic`, the watcher-echo check and "a dirty buffer is never overwritten from disk" are unchanged. `save_note` does no DB work.
- Canvas (`isCanvasPath`) and Base (`isBasePath`) tabs never enter or move to group 1; opening one from sidebar/links opens it in group 0 and focuses it.
- Layout persists in `.workspace.json` (gitignored UI state) only; no new storage location. Rust fields use `#[serde(default)]`.
- Keymap defaults: `split-editor` `Ctrl+\`, `focus-next-group` `Ctrl+Alt+ArrowRight`, `focus-prev-group` `Ctrl+Alt+ArrowLeft`, `toggle-sidebar` moves to `Ctrl+Shift+B`. No default for `split-editor-down`, `close-editor-group`, `reset-split-ratio`, `toggle-split-direction`.
- Project rules: no `any`, no comments unless the WHY is non-obvious, named exports, no `.unwrap()`/`.expect()` outside tests, new classNames must exist in `src/index.css`. Before each commit: `npm run typecheck`, `npm run lint`, `npm test`; for Rust tasks also `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test` (from `src-tauri/`). After code changes run `graphify update .`.
- One commit per task, message style `feat(scope): …` / `refactor(scope): …`, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. Typing in one group while the same note is open in the other raises no conflict bar in either group, and the other group's editor shows the new text. (Task 2)
2. Closing a note's tab in one group while the other group still shows it neither flushes-and-releases the buffer nor runs the asset GC; GC runs once the last group drops it. (Task 1)
3. Window close with unsaved edits in notes shown in both groups writes every buffer. (Task 3)
4. A legacy `.workspace.json` (`openTabs`/`activeTab`/`secondaryTab`/`splitRatio`, no layout) opens as the same split, and a layout referencing deleted notes or a canvas in group 1 collapses cleanly. (Task 6)
5. Renaming or deleting a folder containing notes open in both groups updates/closes them in both and leaves a valid focused group. (Task 4)

---

## Phase 1 — Shared note buffers (no visible change)

### Task 1: Path-keyed note-buffer store

**Files:**
- Create: `src/store/noteBuffers.ts`
- Test: `src/store/noteBuffers.test.ts`

**Interfaces:**
- Produces:
  - `interface NoteBuffer { content: string; loadedPath: string | null; failedPath: string | null; isLoading: boolean; saveState: SaveState; saveError: string | null; conflict: boolean }`
  - `acquireNote(path: string): void` / `releaseNote(path: string): void` (ref-counted; first acquire opens the note and registers the one `workspace-changed` listener for it; last release runs flush → `api.assets.gc` → `addGitPendingPath(sidecarDir(path, 'assets'))`, today's `useNote` cleanup)
  - `useNoteBuffers: UseBoundStore<StoreApi<{ buffers: Record<string, NoteBuffer> }>>`
  - `saveNote(path: string, markdown: string): void`, `flushNote(path: string): Promise<void>`, `flushAllNotes(): Promise<void>`, `retrySaveNote(path)`, `dismissNoteError(path)`, `keepMine(path)`, `reloadTheirs(path)`
  - Timers, pending jobs, `recentWrites` (ring of 4), `incoming` and the contentRef equivalent live in a module-private `Map<string, Internal>`, not in Zustand state.
- Consumes: `SaveState`, `SAVE_DEBOUNCE_MS`/`REINDEX_DEBOUNCE_MS` (move the constants and `SaveState` here, re-export from `hooks/useNote.ts`), `api.notes.{open,save,reindex}`, `useDirtyPathsStore`, `useSettingsStore` (`autosaveDebounceMs`), `useWorkspaceStore.getState().path`.

Port `useNote.ts` logic 1:1 per path; do not change behaviour. Preserve: `saveNote` ignored until `loadedPath === path`; failed open leaves content `''`, sets `failedPath` and `saveError` "Couldn't open note: …"; dirty-path marking (clean ⇒ `markClean`, else `markDirty`); watcher echo check against `contentRef` and `recentWrites`; hold autosave while `incoming` is set; `beforeunload` flushes everything (register once at module load).

- [ ] **Step 1: Write failing tests** in `noteBuffers.test.ts` (mock `api` and `@tauri-apps/api/event` as `useNote.test.ts` does): `acquire twice opens the note once`; `release of one of two holders neither flushes nor runs assets.gc` (Review Focus 2); `release of the last holder flushes then calls assets.gc with the content at release time`; `saveNote before load is dropped`; `failed open refuses saves`; `own write echoed by watcher raises no conflict`; `external change on a dirty buffer sets conflict and holds autosave`; `flushAllNotes writes every dirty buffer`.
- [ ] **Step 2: Run** `npx vitest run src/store/noteBuffers.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/store/noteBuffers.ts` per Interfaces.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `refactor(notes): add path-keyed ref-counted note buffer store`.

### Task 2: `useNote` becomes a subscriber

**Files:**
- Modify: `src/hooks/useNote.ts` (shrinks to a thin subscriber)
- Test: `src/hooks/useNote.test.ts` (existing, must pass unchanged), add `src/hooks/useNoteShared.test.ts`

**Interfaces:**
- Produces: `useNote(path: string | null)` with the **same return shape as today** (`content, save, isLoading, saveState, saveError, flush, retrySave, dismissError, conflict, keepMine, reloadTheirs`). Calls `acquireNote(path)` in an effect and `releaseNote(path)` in its cleanup; `null` path returns the empty state.
- Consumes: Task 1 API.

- [ ] **Step 1: Write failing test** `useNoteShared.test.ts`: mount two `useNote('/w/a.md')` hooks; `save('x')` on the first → both return `content === 'x'`, `conflict === false` on both after the watcher echo fires, and `api.notes.save` called once after the debounce (Review Focus 1).
- [ ] **Step 2: Run** `npx vitest run src/hooks/useNoteShared.test.ts` — Expected: FAIL.
- [ ] **Step 3: Rewrite** `useNote` over the store; keep exports `SAVE_DEBOUNCE_MS`, `REINDEX_DEBOUNCE_MS`, `SaveState`.
- [ ] **Step 4: Run** `npx vitest run src/hooks src/store` — Expected: PASS including the untouched existing `useNote.test.ts`.
- [ ] **Step 5: Commit** `refactor(notes): useNote reads shared per-path buffers`.

### Task 3: Flush every buffer on window close

**Files:**
- Modify: `src/components/Layout.tsx` (the `close-requested` handler, ~lines 135-147; replace the two named `flush`/`flushSecondary` calls with `flushAllNotes()`)
- Test: `src/components/Layout.test.tsx`

**Interfaces:** Consumes `flushAllNotes` from Task 1.

- [ ] **Step 1: Write failing test** in `Layout.test.tsx`: with two dirty buffers, firing `close-requested` results in `api.notes.save` called for both paths before the window closes (Review Focus 3).
- [ ] **Step 2: Run** `npx vitest run src/components/Layout.test.tsx -t "close-requested"` — Expected: FAIL.
- [ ] **Step 3: Implement** the replacement.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(save): close-requested flushes every note buffer`.

---

## Phase 2 — Group model, store and persistence

### Task 4: Pure group reducers

**Files:**
- Create: `src/lib/editorGroups.ts`
- Test: `src/lib/editorGroups.test.ts`

**Interfaces:**
- Produces (all pure, return a new `GroupLayout`):
  - `type ViewMode = 'wysiwyg' | 'raw'` (reuse the existing one if already exported, else define here and import elsewhere), `type SplitSide = 'left' | 'right' | 'up' | 'down'`
  - `interface EditorGroup { tabs: string[]; pinned: string[]; active: string | null; viewMode: ViewMode }`
  - `interface GroupLayout { groups: EditorGroup[]; focused: number; direction: 'row' | 'column'; ratio: number }`
  - `initialLayout(): GroupLayout` (one empty group, focused 0, row, 0.5)
  - `openIn(l, path, group = l.focused)` — adds if absent, activates, focuses that group; canvas/base paths force group 0
  - `closeTabIn(l, path, group)` — next active is the last remaining tab; an emptied group 1 (or emptied group 0 while group 1 exists) is removed, focus clamps
  - `splitActive(l, side)` — no-op when 2 groups, no active tab, or active is canvas/base; copies the active path into a new group on `side` (`left`/`up` ⇒ new group first; `left`/`right` ⇒ `row`, `up`/`down` ⇒ `column`), focuses it, new group's `viewMode` copies the source's
  - `moveTab(l, path, from, to, copy: boolean)` — canvas/base refused for `to === 1`; moving the last tab away closes that group; pinned status does not travel
  - `closeGroup(l, group): { layout: GroupLayout; dropped: string[] }` — `dropped` = paths no longer open in any group
  - `toggleDirection(l)`, `setRatio(l, r)` (clamp 0.2–0.8), `setViewMode(l, group, mode)`, `setFocused(l, group)`
  - `pinToggle(l, path, group)`, `reorderIn(l, from, to, group)` — keep "pinned are a prefix"
  - `replacePrefixAll(l, old, new)`, `removeUnder(l, prefix)`
  - `openPaths(l): string[]` (deduped across groups)
- Consumes: `isCanvasPath`, `isBasePath` (`src/lib/canvasPath`), `replacePathPrefix`, `isUnderPath` (`src/lib/pathPrefix`).

- [ ] **Step 1: Write failing tests**, one per behaviour above with exact assertions, including: `splitActive('left')` puts the new group at index 0 with `direction 'row'`; `splitActive` on a canvas is a no-op; `moveTab` last tab closes source group; `closeTabIn` of the only tab in group 1 collapses to one group with `focused 0`; `removeUnder` on a folder holding notes open in both groups closes them in both and keeps `focused` valid (Review Focus 5); `replacePrefixAll` rewrites tabs, pinned and active in both groups.
- [ ] **Step 2: Run** `npx vitest run src/lib/editorGroups.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): pure two-group layout reducers`.

### Task 5: Store drives groups

**Files:**
- Modify: `src/store/workspace.ts` (remove `secondaryTab`, `setSecondaryTab`; add group state), `src/lib/navigationHistory.ts` and `src/lib/requestCloseTab.ts` only if their tests fail
- Test: `src/store/workspace.test.ts`

**Interfaces:**
- Produces (store fields/actions):
  - `layout: GroupLayout`
  - `openTabs`, `pinnedTabs`, `activeTab`: projection of `layout.groups[layout.focused]`, written **only** by one private `commit(next: GroupLayout, extra?: Partial<WorkspaceStore>)` that does a single `set`; no other code path sets them.
  - `splitDirection`/`splitRatio` are replaced by `layout.direction`/`layout.ratio`; `setSplitRatio(r)` kept as a wrapper over `setRatio`.
  - Actions: `splitEditor(side: SplitSide)`, `moveTabToGroup(path: string, to: number, copy: boolean)`, `focusGroup(group: number)`, `focusNextGroup()`, `focusPrevGroup()`, `closeEditorGroup()`, `toggleSplitDirection()`, `resetSplitRatio()`, `setGroupViewMode(group: number, mode: ViewMode)`.
  - Existing actions keep names/semantics but act on the focused group via the reducers: `openTab`, `closeTab` (also pushes to `closedTabs` only when the path is no longer open in any group), `setActiveTab`, `reopenClosedTab`, `reorderTabs`, `togglePinTab`, `setPinnedTabs`, `replaceOpenPath`, `closeTabsUnder`, `resetForNewWorkspace`.
  - New per-group variants used by the tab bars: `activateTabIn(path, group)`, `closeTabInGroup(path, group)`.
- Consumes: Task 4 reducers.

- [ ] **Step 1: Write failing tests** in `workspace.test.ts` (update existing `secondaryTab` tests to the new model): projection equals focused group after every action; `closeTab` on a path open in both groups keeps it in the other and does not push `closedTabs`; `focusNextGroup` with one group is a no-op; `closeEditorGroup` pushes only paths that fall out of every group; `goBack` after focusing group 1 opens in group 1.
- [ ] **Step 2: Run** `npx vitest run src/store/workspace.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the store changes; fix compile errors in the files `npm run typecheck` flags (known: `useWorkspace.ts`, `useGitConfig.ts`, `Layout.tsx` — handled minimally here by removing `secondaryTab` usage; Layout keeps rendering one pane until Task 7).
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `refactor(store): editor groups replace secondaryTab`.

### Task 6: Persist the layout, migrate legacy files

**Files:**
- Modify: `src/types/index.ts` (`WorkspaceState`), `src/hooks/useWorkspace.ts` (`saveSession`, `openWorkspaceAt`), `src/hooks/useGitConfig.ts`, `src/lib/editorGroups.ts`, `src/web/memoryWorkspace.ts` if it builds a `WorkspaceState`, `src-tauri/src/models.rs`
- Test: `src/lib/editorGroups.test.ts`, `src/hooks/useWorkspace.test.ts`, Rust test next to `WorkspaceState` (follow the existing round-trip test)

**Interfaces:**
- Produces:
  - TS: `WorkspaceState.layout?: { groups: { tabs: string[]; pinned: string[]; active: string | null; viewMode: ViewMode }[]; focused: number; direction: 'row' | 'column'; ratio: number }`; `secondaryTab`/`splitRatio` removed from the TS type; `openTabs`/`activeTab`/`pinnedTabs` keep being written as group 0's values.
  - `layoutFromSession(s: WorkspaceState, existing: (path: string) => boolean): GroupLayout` and `sessionLayout(l: GroupLayout): NonNullable<WorkspaceState['layout']>` in `editorGroups.ts`. `layoutFromSession` uses `layout` when present, else builds group 0 from `openTabs`/`activeTab`/`pinnedTabs` and, if the legacy `secondaryTab` is set, a second group (row, ratio `splitRatio ?? 0.5`). Drops paths for which `existing` is false and canvas/base paths in group 1; collapses an empty group 1; clamps `focused`/`ratio`.
  - Rust: `EditorGroupState { tabs: Vec<String>, pinned: Vec<String>, active: Option<String>, view_mode: String }`, `EditorLayoutState { groups: Vec<EditorGroupState>, focused: usize, direction: String, ratio: f64 }` (camelCase like the rest; `#[derive(Debug, Clone, Serialize, Deserialize)]`), and `#[serde(default)] pub layout: Option<EditorLayoutState>` on `WorkspaceState`. `secondary_tab`/`split_ratio` stay readable (`#[serde(default, skip_serializing)]`) for legacy files.
- Consumes: Task 4/5.

- [ ] **Step 1: Write failing tests**: TS — `layoutFromSession` for a legacy file with `secondaryTab` yields a 2-group row at the old ratio; for a layout with deleted notes and a canvas in group 1 yields a valid single group (Review Focus 4); `sessionLayout`→`layoutFromSession` round-trips. Hook test — `openWorkspaceAt` restores the layout into the store. Rust — a JSON string with only `openTabs`/`activeTab` still deserializes; a full layout round-trips; a file containing `secondaryTab` deserializes.
- [ ] **Step 2: Run** `npx vitest run src/lib/editorGroups.test.ts src/hooks/useWorkspace.test.ts` and `cargo test workspace` (from `src-tauri/`) — Expected: FAIL.
- [ ] **Step 3: Implement** TS and Rust changes; `saveSession` and `useGitConfig` send `layout`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`, then `cargo fmt && cargo clippy -- -D warnings && cargo test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(workspace): persist editor group layout with legacy migration`.

---

## Phase 3 — Per-group UI

### Task 7: Group container, per-group tab bar and panes

**Files:**
- Create: `src/components/EditorGroups.tsx` (two-slot flex container), `src/components/EditorGroupPane.tsx` (one group: `TabBar` + `EditorPane` + Outline/Outgoing Links), `src/components/SplitDivider.tsx`, `src/hooks/useSplitDivider.ts`
- Modify: `src/components/Layout.tsx` (drop `primary*`/`secondary*` state, both `useNote` blocks, `startPaneResize`, drag-drop handlers; render `<EditorGroups …/>`), `src/components/TabBar.tsx`, `src/components/EditorPane.tsx`, `src/index.css`
- Test: `src/components/Layout.test.tsx`, `src/components/EditorGroups.test.tsx`

**Interfaces:**
- Produces:
  - `TabBar` props gain `group: number` and `showStatus: boolean`; it reads `layout.groups[group]`, uses `activateTabIn`/`closeTabInGroup`, and renders the save chip, git status and Sync controls only when `showStatus` (true for group 0). The save chip shows the focused group's active note state. Nav buttons render only in group 0's bar.
  - `EditorGroupPane({ group }: { group: number })` calls `useNote(layout.groups[group].active)` itself and passes the existing `EditorPaneProps`; marks focus via `onMouseDownCapture`/`onFocusCapture` → `focusGroup(group)`; adds class `editor-group--focused` to the focused group when two exist.
  - `EditorPane`: `onClose`-gated header is replaced by always rendering the Source/Preview toggle for groups when two exist; group 0's toggle stays in the tab bar status area only when there is one group. `emptyState` rendering stays for group 0 only.
  - `EditorGroups` lays out `layout.direction` with flex-basis from `layout.ratio`; `useSplitDivider(containerRef, direction)` returns `{ onMouseDown }` using `clientX` for `row`, `clientY` for `column`.
- Consumes: Task 5 store API; `useNote` (Layout still calls `useNote(focusedActive)` for the export/print path, window title and `OutlinePanel`'s `content`; ref-counting makes this safe).

- [ ] **Step 1: Write failing tests** `EditorGroups.test.tsx`: one group renders one tab bar; after `splitEditor('right')` two tab bars with independent tab lists render, each with its own `Source/Preview` toggle; mousedown in group 1 sets `layout.focused === 1`; the status chip appears only in group 0's bar.
- [ ] **Step 2: Run** `npx vitest run src/components/EditorGroups.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** Grep `src/index.css` for every className introduced and add rules (`editor-group--focused`, `split-divider`, column variants); verify spacing by screenshot via the `ui-preview` skill (see project memory on spacing gaps). `Layout.tsx` must shrink, not grow.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): render editor groups with per-group tab bars`.

### Task 8: Per-group view mode and focused-group commands

**Files:**
- Modify: `src/components/Layout.tsx` (remove the effect that resets view mode on `activeTab` change; `toggle-view`, export and print act on the focused group), `src/components/EditorGroupPane.tsx`
- Test: `src/components/Layout.test.tsx`

**Interfaces:** Consumes `setGroupViewMode(group, mode)` and `layout.groups[g].viewMode`. Export/print set the focused group's mode to `'wysiwyg'` via `setGroupViewMode`.

- [ ] **Step 1: Write failing tests**: switching tabs inside a group keeps its Source mode; `Ctrl+E` toggles only the focused group; reopening the workspace restores each group's mode.
- [ ] **Step 2: Run** `npx vitest run src/components/Layout.test.tsx -t "view mode"` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): per-group Source/Preview mode`.

### Task 9: Divider reset and keyboard resize

**Files:**
- Modify: `src/components/SplitDivider.tsx`, `src/hooks/useSplitDivider.ts`
- Test: `src/components/EditorGroups.test.tsx`

**Interfaces:** `SplitDivider` renders `role="separator"`, `aria-orientation`, `aria-valuenow`/`min`/`max` (20/80), `tabIndex={0}`; ArrowLeft/Up `−0.05`, ArrowRight/Down `+0.05` (by direction), Home ⇒ 0.2, End ⇒ 0.8, `onDoubleClick` ⇒ `resetSplitRatio()`.

- [ ] **Step 1: Write failing tests**: double-click sets ratio 0.5; ArrowRight from 0.5 gives 0.55; repeated ArrowLeft never goes below 0.2; Home/End hit the clamps.
- [ ] **Step 2: Run** `npx vitest run src/components/EditorGroups.test.tsx -t divider` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): divider reset and keyboard resize`.

---

## Phase 4 — Drops, commands, shortcuts

### Task 10: Edge and group drop zones

**Files:**
- Create: `src/lib/dropZone.ts`, `src/hooks/useTabDrop.ts`
- Modify: `src/components/EditorGroups.tsx`, `src/components/EditorGroupPane.tsx`, `src/components/TabBar.tsx` (tab drops onto another group's bar/body), `src/index.css`
- Test: `src/lib/dropZone.test.ts`, `src/components/EditorGroups.test.tsx`

**Interfaces:**
- Produces: `type DropZone = SplitSide | 'center'`; `dropZoneAt(rect: { left: number; top: number; width: number; height: number }, x: number, y: number, groupCount: number): DropZone` — with one group the outer 25% of each edge maps to that side (nearest edge wins in corners), otherwise `'center'`; with two groups always `'center'`. `useTabDrop(group)` returns drag handlers that, on drop, call `splitEditor`+`moveTabToGroup`-equivalent for an edge, or `moveTabToGroup(path, group, e.ctrlKey)` for center; canvas/base paths are rejected for edges and group 1.
- Replaces `handleEditorDragOver`/`handleEditorDrop`/`splitDropZoneActive` in `Layout.tsx`.

- [ ] **Step 1: Write failing tests**: `dropZoneAt` returns `'right'` at x = 90% of width, `'up'` at y = 10%, `'center'` in the middle, `'center'` everywhere when `groupCount === 2`; component test: dropping a tab on the left edge with one group produces two groups with the dropped tab's note in group 0.
- [ ] **Step 2: Run** `npx vitest run src/lib/dropZone.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** with a highlight overlay per zone (reuse the existing `split-drop-zone` styling, one class per side).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): split by dropping a tab on any edge`.

### Task 11: Commands, keymap and context menu

**Files:**
- Modify: `src/lib/keymap.ts`, the component that dispatches keymap commands (find with `grep -rn "toggle-sidebar" src`), `src/components/TabBar.tsx` (context menu), shortcuts help data if separate from `keymap.ts`
- Test: `src/lib/keymap.test.ts`, `src/components/TabBar.test.tsx`

**Interfaces:** New `def(...)` entries per Global Constraints, category `View`: `split-editor` ("Split Editor Right", `Ctrl+\`), `split-editor-down`, `focus-next-group`, `focus-prev-group`, `close-editor-group`, `reset-split-ratio`, `toggle-split-direction`; `toggle-sidebar` default becomes `Ctrl+Shift+B`. `split-editor` splits `right` in a row layout. Tab context menu gains Split Right/Left/Up/Down, disabled for canvas/base tabs and when two groups exist.

- [ ] **Step 1: Write failing tests**: no two commands share a default key; `commandById('split-editor').defaultKey === 'Ctrl+\\'`; `toggle-sidebar` is `Ctrl+Shift+B`; the context menu offers four split items for a note tab and disables them when two groups exist.
- [ ] **Step 2: Run** `npx vitest run src/lib/keymap.test.ts src/components/TabBar.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** and wire each command id to its store action.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(editor): split and focus commands, Ctrl+\ splits, sidebar moves to Ctrl+Shift+B`.

### Task 12: End-to-end check and docs

**Files:**
- Create: `e2e/specs/editor-groups.spec.ts`
- Modify: `docs/ROADMAP.md` (split-pane row and the `Ctrl+\` mentions), `docs/specs/split-pane-editing-design.md` (add "Superseded by editor-groups-design.md" at the top)

- [ ] **Step 1: Write the spec** following the `e2e-verify` skill: split with the keyboard, open different notes per group, type in one group while the same note is open in the other (text appears, no conflict bar), move focus with `Ctrl+Alt+Arrow`, close the group, relaunch and see the same layout.
- [ ] **Step 2: Run** `npm run test:e2e -- --spec e2e/specs/editor-groups.spec.ts` — Expected: PASS; inspect screenshots for spacing and the focused-group indicator.
- [ ] **Step 3: Update docs** as listed.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test` and `graphify update .` — Expected: clean.
- [ ] **Step 5: Commit** `docs: editor groups roadmap and e2e coverage (#235)`.
