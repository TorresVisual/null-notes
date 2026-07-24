# Navigation & Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Remove the redundant sidebar title-filter and fix two workspace-switching bugs (session not saved on switch; stale tabs/expanded-folders leaking between workspaces), per `docs/specs/navigation-organization-design.md`.

**Architecture:** Two independent fixes: (1) delete dead filter UI/state from `Sidebar.tsx` and its CSS rule, (2) add a `resetForNewWorkspace()` store action and reorder `useWorkspace.ts`'s `openWorkspace()` to save-then-reset before loading the new workspace.

**Tech Stack:** React 19 + TypeScript (strict), Zustand, Vitest.

## Global Constraints

- No change to `beforeunload`-triggered session saving — only the workspace-switch path gains a save call (spec Non-Goals).
- No note-level rename/context-menu (spec Non-Goals).
- No changes to the `Ctrl+K` search modal, tag list, backlinks panel, or folder tree beyond the filter removal (spec Non-Goals).
- `npm run lint` does not exist in this repo (no script, no ESLint config) — use `npm run typecheck` only.

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

### Task 1: Remove the redundant sidebar filter

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/index.css`

**Interfaces:** none — purely removes dead UI/state, no other file references `search`, `visibleNotes`, or `.search-input`.

- [ ] **Step 1: Remove the filter state and simplify the tree computation**

In `src/components/Sidebar.tsx`, replace:

```tsx
  const { openWorkspace } = useWorkspace()
  const [search, setSearch] = useState('')
  const [tagFilteredNotes, setTagFilteredNotes] = useState<NoteMetadata[]>([])
```

with:

```tsx
  const { openWorkspace } = useWorkspace()
  const [tagFilteredNotes, setTagFilteredNotes] = useState<NoteMetadata[]>([])
```

Then replace:

```tsx
  const visibleNotes = search.trim()
    ? notes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
    : notes

  const tree = workspacePath ? buildFolderTree(workspacePath, folders, visibleNotes) : []
```

with:

```tsx
  const tree = workspacePath ? buildFolderTree(workspacePath, folders, notes) : []
```

- [ ] **Step 2: Remove the filter input element**

In `src/components/Sidebar.tsx`, replace:

```tsx
      <ImportButton />
      <button className="search-open-btn" onClick={onSearchOpen}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={13} /> Search
        </span>
        <kbd>Ctrl K</kbd>
      </button>
      <input
        className="search-input"
        type="search"
        placeholder="Filter by title…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Filter notes by title"
      />
      {folderError && <p className="sidebar-error">{folderError}</p>}
```

with:

```tsx
      <ImportButton />
      <button className="search-open-btn" onClick={onSearchOpen}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={13} /> Search
        </span>
        <kbd>Ctrl K</kbd>
      </button>
      {folderError && <p className="sidebar-error">{folderError}</p>}
```

- [ ] **Step 3: Remove the unused CSS rule**

In `src/index.css`, replace:

```css
/* Sidebar search */
.search-input {
  width: 100%;
  padding: 5px 8px;
  background: var(--bg-base);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.search-input:focus { border-color: var(--accent); }
.search-input::placeholder { color: var(--text-tertiary); }

/* Sidebar search-open button */
```

with:

```css
/* Sidebar search-open button */
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Run the full test suite as a regression check**

Run: `npm run test`
Expected: PASS — no existing test references the removed state/input.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/index.css
git commit -m "fix: remove redundant sidebar title-filter, Ctrl+K covers it"
```

---

### Task 2: Fix workspace-switching session loss and tab leakage

**Files:**
- Modify: `src/store/workspace.ts`
- Modify: `src/store/workspace.test.ts`
- Modify: `src/hooks/useWorkspace.ts`

**Interfaces:**
- Produces: `resetForNewWorkspace(): void` on `WorkspaceStore`, consumed by `useWorkspace.ts`'s `openWorkspace()`.
- Consumes: nothing new — `saveSession` already exists in `useWorkspace.ts` and is just reordered.

- [ ] **Step 1: Write the failing test**

In `src/store/workspace.test.ts`, add inside the `describe('useWorkspaceStore', ...)` block (after the last existing `it`, before the closing `})`):

```ts
  it('resetForNewWorkspace clears all per-workspace UI state', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().toggleFolder('/ws/A')
    useWorkspaceStore.getState().setSelectedFolder('/ws/A')
    useWorkspaceStore.getState().openFolderContextMenu('/ws/A', 10, 20)
    useWorkspaceStore.getState().setFolderError('some error')
    useWorkspaceStore.getState().setTagFilter('cs101')

    useWorkspaceStore.getState().resetForNewWorkspace()

    expect(useWorkspaceStore.getState().openTabs).toEqual([])
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
    expect(useWorkspaceStore.getState().expandedFolders).toEqual([])
    expect(useWorkspaceStore.getState().selectedFolder).toBeNull()
    expect(useWorkspaceStore.getState().folderContextMenu).toBeNull()
    expect(useWorkspaceStore.getState().folderError).toBeNull()
    expect(useWorkspaceStore.getState().tagFilter).toBeNull()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/store/workspace.test.ts`
Expected: FAIL — `useWorkspaceStore.getState().resetForNewWorkspace is not a function`.

- [ ] **Step 3: Add the store action**

In `src/store/workspace.ts`, add `resetForNewWorkspace: () => void` to the `WorkspaceStore` interface, immediately after `setTagFilter: (tag: string | null) => void`:

```ts
  tagFilter: string | null
  setTagFilter: (tag: string | null) => void
  resetForNewWorkspace: () => void
}
```

Then add the implementation at the end of the store body, immediately after `setTagFilter: (tag) => set({ tagFilter: tag }),`:

```ts
  setFolderError: (message) => set({ folderError: message }),
  setTagFilter: (tag) => set({ tagFilter: tag }),

  resetForNewWorkspace: () =>
    set({
      openTabs: [],
      activeTab: null,
      expandedFolders: [],
      selectedFolder: null,
      folderContextMenu: null,
      folderError: null,
      tagFilter: null,
    }),
}))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/store/workspace.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Reorder `openWorkspace()` to save-then-reset before loading the new workspace**

In `src/hooks/useWorkspace.ts`, replace the full `useWorkspace` function:

```ts
export function useWorkspace() {
  const { setPath, openTab, setExpandedFolders } = useWorkspaceStore()
  const { setNotes, setFolders } = useNotesStore()

  const openWorkspace = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return

    setPath(selected)
    const [tree, session] = await Promise.all([
      api.notes.scan(selected),
      api.workspace.load(selected),
    ])
    setNotes(tree.notes)
    setFolders(tree.folders)
    setExpandedFolders(session.expandedFolders)
    for (const tab of session.openTabs) {
      openTab(tab)
    }
    await refreshTags()
  }, [setPath, setNotes, setFolders, setExpandedFolders, openTab])

  const saveSession = useCallback(async () => {
    const { path, openTabs, activeTab, expandedFolders } = useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, { openTabs, activeTab, expandedFolders })
  }, [])

  return { openWorkspace, saveSession }
}
```

with:

```ts
export function useWorkspace() {
  const { setPath, openTab, setExpandedFolders, resetForNewWorkspace } = useWorkspaceStore()
  const { setNotes, setFolders } = useNotesStore()

  const saveSession = useCallback(async () => {
    const { path, openTabs, activeTab, expandedFolders } = useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, { openTabs, activeTab, expandedFolders })
  }, [])

  const openWorkspace = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return

    await saveSession()
    resetForNewWorkspace()

    setPath(selected)
    const [tree, session] = await Promise.all([
      api.notes.scan(selected),
      api.workspace.load(selected),
    ])
    setNotes(tree.notes)
    setFolders(tree.folders)
    setExpandedFolders(session.expandedFolders)
    for (const tab of session.openTabs) {
      openTab(tab)
    }
    await refreshTags()
  }, [setPath, setNotes, setFolders, setExpandedFolders, openTab, resetForNewWorkspace, saveSession])

  return { openWorkspace, saveSession }
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Run the full test suite**

Run: `npm run test`
Expected: PASS — all test files, including the new `resetForNewWorkspace` test.

- [ ] **Step 8: Commit**

```bash
git add src/store/workspace.ts src/store/workspace.test.ts src/hooks/useWorkspace.ts
git commit -m "fix: save outgoing session and reset per-workspace state on workspace switch"
```

---

### Task 3: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and test run**

Run: `npm run typecheck && npm run test`
Expected: both exit 0, all test files pass.

- [ ] **Step 2: Manual QA walkthrough**

Run: `npm run tauri dev`.
1. Confirm the sidebar no longer shows a "Filter by title…" input — only the `Ctrl+K` search button remains.
2. Open workspace A (any folder with a couple of notes), open 2 tabs, expand a folder.
3. Click "Open Workspace" and pick a different folder (workspace B) — confirm workspace A's tabs do not appear in B's tab bar (tab bar is either empty or shows only B's previously-saved session).
4. Switch back to workspace A via "Open Workspace" — confirm A's tabs and expanded folder are restored (this proves the session was actually saved on the way out in step 3).

Expected: no console errors in devtools; all four behaviors match.

- [ ] **Step 3: Fix any issues found**

If Step 2 surfaces a problem, fix it in the relevant file, re-run Step 1, and commit as `fix: <description>`.
