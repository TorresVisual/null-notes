# Split-Pane Editing Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Let a user drag a tab to the right edge of the editor to open a second note beside the first, each pane independently toggleable between WYSIWYG and raw markdown, with the split persisted in `.workspace.json`.

**Architecture:** Extract the existing single-pane render block in `Layout.tsx` into a presentational `EditorPane` component that takes note data as props (Layout keeps owning both `useNote` calls, so `flush()` stays reachable for both panes on window close). `Layout` renders one `EditorPane` normally and two side by side, separated by a drag-resizable divider, once `secondaryTab` is set. `secondaryTab`/`splitRatio` live in `useWorkspaceStore` and round-trip through `.workspace.json` the same way `git` did when it was added after the file already existed.

**Tech Stack:** React 19 + TypeScript, Zustand, native HTML5 drag-and-drop (no new dependency), Rust/serde for the `.workspace.json` mirror.

**Spec:** [docs/specs/split-pane-editing-design.md](../specs/split-pane-editing-design.md)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- TypeScript strict mode: no `any`, no non-null assertions unless the null case is structurally impossible.
- Named exports everywhere except route/page-level components.
- Rust: no `.unwrap()`/`.expect()` outside tests; `cargo clippy -- -D warnings` and `cargo fmt --check` must pass locally before pushing (CI does not catch a bad push to `main`).
- Frontend tests: `npm test` (vitest). Rust tests: `cargo test` (from `src-tauri/`).
- Exactly 2 panes, no nesting (per spec's "Out of scope").
- One shared tab strip; a pane is a pointer into `openTabs`, not a second tab list.

---

### Task 1: Guard cross-pane window-event commands to the focused editor

Two global `window` events — `command:insert-ink` (`src/editor/toolbar/EditorToolbar.tsx:55`) and `command:split-tasks` (`src/editor/NoteEditor.tsx:199`) — are each listened to once per mounted `NoteEditor`/`EditorToolbar` instance, with no check for which editor is focused. Today that's safe because only one `NoteEditor` is ever mounted. Once split-pane mounts two, triggering either command from the menu/shortcut would fire in **both** panes at once (e.g. "Split into Tasks" prompting twice, or an ink block landing in the wrong pane). Fixing this first, before two editors can ever coexist in this codebase, means the later tasks build on a correct foundation rather than shipping a latent double-fire bug.

**Files:**
- Modify: `src/editor/toolbar/EditorToolbar.tsx:50-57`
- Modify: `src/editor/NoteEditor.tsx:183-201`
- Test: `src/editor/toolbar/editorToolbar.test.tsx`
- Test: `src/editor/NoteEditor.test.tsx`

**Interfaces:**
- No new exports. `Editor.isFocused` is a stock TipTap/ProseMirror `Editor` property already available on the `editor` value both files already hold.

- [ ] **Step 1: Write the failing test for `command:insert-ink`**

Add to `src/editor/toolbar/editorToolbar.test.tsx` (needs `vi.mock('./insertInk', ...)` added near the top, alongside the existing `vi.mock('../../lib/ink', ...)`):

```ts
vi.mock('./insertInk', () => ({ insertInk: vi.fn().mockResolvedValue(undefined) }))
```

```ts
import { insertInk } from './insertInk'

// ... inside describe('the editor toolbar', () => { ... })

it('command:insert-ink only inserts into the focused editor when two are mounted', async () => {
  const { container } = render(
    <>
      <NoteEditor content="first" notePath="/ws/a.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} onFlashcardCommand={() => {}} />
      <NoteEditor content="second" notePath="/ws/b.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} onFlashcardCommand={() => {}} />
    </>,
  )
  const [firstPm, secondPm] = Array.from(container.querySelectorAll('.ProseMirror'))
  await waitFor(() => expect(firstPm.textContent).toContain('first'))
  clickInto(secondPm as HTMLElement)

  window.dispatchEvent(new Event('command:insert-ink'))

  await waitFor(() => expect(insertInk).toHaveBeenCalledTimes(1))
  expect(vi.mocked(insertInk).mock.calls[0][1]).toBe('/ws/b.md')
})
```

`clickInto` is the helper already defined lower in this file (`editorToolbar.test.tsx:114-129`) — move its declaration above this new test (or leave it where it is and place this test after that point in the file, since `it` blocks don't need declaration order relative to each other, only that `clickInto` is defined somewhere in module scope before the test file finishes evaluating — a top-level `function` declaration is hoisted, so no reordering is actually required).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- editorToolbar.test.tsx`
Expected: FAIL — `insertInk` called twice (once per mounted `EditorToolbar`), not once.

- [ ] **Step 3: Fix `EditorToolbar`'s handler**

In `src/editor/toolbar/EditorToolbar.tsx`, change the `onInsertInk` handler (lines 50-57):

```ts
useEffect(() => {
  function onInsertInk() {
    if (!editor || !editor.isFocused) return
    void insertInk(editor, notePath).catch(report)
  }
  window.addEventListener('command:insert-ink', onInsertInk)
  return () => window.removeEventListener('command:insert-ink', onInsertInk)
}, [editor, notePath])
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -- editorToolbar.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for `command:split-tasks`**

Add to `src/editor/NoteEditor.test.tsx` (needs a new mock at the top of the file):

```ts
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn().mockResolvedValue(false),
  message: vi.fn().mockResolvedValue(undefined),
}))
```

```ts
import { confirm } from '@tauri-apps/plugin-dialog'

describe('command:split-tasks focus guard', () => {
  it('only prompts for the focused editor when two are mounted', async () => {
    const { container } = render(
      <>
        <NoteEditor content="Exercise 1" notePath="/ws/a.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} onFlashcardCommand={() => {}} />
        <NoteEditor content="Exercise 2" notePath="/ws/b.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} onFlashcardCommand={() => {}} />
      </>,
    )
    const [firstPm, secondPm] = Array.from(container.querySelectorAll('.ProseMirror'))
    await waitFor(() => expect(firstPm.textContent).toContain('Exercise 1'))
    ;(secondPm as HTMLElement).focus()

    window.dispatchEvent(new Event('command:split-tasks'))

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  })
})
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npm test -- NoteEditor.test.tsx`
Expected: FAIL — `confirm` called twice.

- [ ] **Step 7: Fix `NoteEditor`'s handler**

In `src/editor/NoteEditor.tsx`, change the `onSplitTasks` function (inside the `useEffect` at lines 183-201):

```ts
useEffect(() => {
  async function onSplitTasks() {
    if (!editor || !editor.isFocused) return
    if (!(await confirm('Rewrite this note into Task / Solution sections, each with a handwriting canvas?'))) return
    try {
      if ((await splitIntoTasks(editor)) === 'no-structure') {
        await message('No exercise structure found in this note — nothing was changed.')
        return
      }
      onChange(markdownOf(editor))
    } catch (error) {
      report(error)
    }
  }
  const handler = () => void onSplitTasks()
  window.addEventListener('command:split-tasks', handler)
  return () => window.removeEventListener('command:split-tasks', handler)
}, [editor, onChange])
```

- [ ] **Step 8: Run it to confirm it passes**

Run: `npm test -- NoteEditor.test.tsx`
Expected: PASS

- [ ] **Step 9: Run the full frontend suite and commit**

Run: `npm test`
Expected: all tests pass

```bash
git add src/editor/toolbar/EditorToolbar.tsx src/editor/NoteEditor.tsx src/editor/toolbar/editorToolbar.test.tsx src/editor/NoteEditor.test.tsx
git commit -m "fix(editor): scope insert-ink/split-tasks commands to the focused editor"
```

---

### Task 2: Workspace store — `secondaryTab` and `splitRatio`

**Files:**
- Modify: `src/store/workspace.ts:23-259`
- Test: `src/store/workspace.test.ts`

**Interfaces:**
- Produces: `useWorkspaceStore.getState().secondaryTab: string | null`, `.splitRatio: number`, `.setSecondaryTab(path: string | null): void`, `.setSplitRatio(ratio: number): void`. `closeTab`, `closeTabsUnder`, `replaceOpenPath`, `resetForNewWorkspace` all updated to also account for `secondaryTab`.

- [ ] **Step 1: Write the failing tests**

First, update the `reset()` helper at the top of `src/store/workspace.test.ts` (`workspace.test.ts:4-22`) so these two fields don't leak between tests via Zustand's shallow-merge `setState`:

```ts
const reset = () =>
  useWorkspaceStore.setState({
    path: null,
    openTabs: [],
    activeTab: null,
    secondaryTab: null,
    splitRatio: 0.5,
    closedTabs: [],
    expandedFolders: [],
    selectedFolder: null,
    folderError: null,
    folderLoading: false,
    tagFilter: null,
    recentWorkspaces: [],
    recentSearches: [],
    repoMode: null,
    git: { prompted: false, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
    gitPendingPaths: [],
    gitCommitStatus: 'idle',
    gitDiverged: null,
  })
```

Then add to the `describe('useWorkspaceStore', ...)` block:

```ts
it('setSecondaryTab opens a second pane on an already-open tab without changing activeTab', () => {
  useWorkspaceStore.getState().openTab('/ws/a.md')
  useWorkspaceStore.getState().openTab('/ws/b.md')
  useWorkspaceStore.getState().setSecondaryTab('/ws/a.md')
  expect(useWorkspaceStore.getState().secondaryTab).toBe('/ws/a.md')
  expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')
})

it('setSecondaryTab adds the path to openTabs if it was not already open', () => {
  useWorkspaceStore.getState().openTab('/ws/a.md')
  useWorkspaceStore.getState().setSecondaryTab('/ws/c.md')
  expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md', '/ws/c.md'])
  expect(useWorkspaceStore.getState().secondaryTab).toBe('/ws/c.md')
})

it('setSecondaryTab accepts null to collapse back to single-pane', () => {
  useWorkspaceStore.getState().openTab('/ws/a.md')
  useWorkspaceStore.getState().setSecondaryTab('/ws/a.md')
  useWorkspaceStore.getState().setSecondaryTab(null)
  expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
  expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md'])
})

it('closeTab clears secondaryTab when the closed path is the secondary pane', () => {
  useWorkspaceStore.getState().openTab('/ws/a.md')
  useWorkspaceStore.getState().openTab('/ws/b.md')
  useWorkspaceStore.getState().setSecondaryTab('/ws/b.md')
  useWorkspaceStore.getState().closeTab('/ws/b.md')
  expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
})

it('closeTabsUnder clears secondaryTab when it sits under the closed prefix', () => {
  useWorkspaceStore.getState().openTab('/ws/Course1/a.md')
  useWorkspaceStore.getState().openTab('/ws/Course10/b.md')
  useWorkspaceStore.getState().setSecondaryTab('/ws/Course1/a.md')
  useWorkspaceStore.getState().closeTabsUnder('/ws/Course1')
  expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
})

it('replaceOpenPath rewrites secondaryTab under the old prefix', () => {
  useWorkspaceStore.getState().openTab('/ws/Course1/a.md')
  useWorkspaceStore.getState().setSecondaryTab('/ws/Course1/a.md')
  useWorkspaceStore.getState().replaceOpenPath('/ws/Course1', '/ws/Renamed')
  expect(useWorkspaceStore.getState().secondaryTab).toBe('/ws/Renamed/a.md')
})

it('setSplitRatio stores the primary pane width fraction', () => {
  useWorkspaceStore.getState().setSplitRatio(0.35)
  expect(useWorkspaceStore.getState().splitRatio).toBe(0.35)
})

it('resetForNewWorkspace clears secondaryTab and splitRatio back to defaults', () => {
  useWorkspaceStore.getState().openTab('/ws/a.md')
  useWorkspaceStore.getState().setSecondaryTab('/ws/a.md')
  useWorkspaceStore.getState().setSplitRatio(0.7)
  useWorkspaceStore.getState().resetForNewWorkspace()
  expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
  expect(useWorkspaceStore.getState().splitRatio).toBe(0.5)
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- workspace.test.ts`
Expected: FAIL — `setSecondaryTab`/`setSplitRatio`/`secondaryTab`/`splitRatio` don't exist yet.

- [ ] **Step 3: Implement in `src/store/workspace.ts`**

Add to the `WorkspaceStore` interface (near `activeTab`/`setActiveTab`, `workspace.ts:26,38`):

```ts
  // The second pane's note, or null for today's single-pane layout. A
  // pointer into openTabs, not a second tab list — see setSecondaryTab.
  secondaryTab: string | null
  setSecondaryTab: (notePath: string | null) => void
  // Primary pane's width as a fraction of the split, 0..1.
  splitRatio: number
  setSplitRatio: (ratio: number) => void
```

Add to the store's initial state (near `activeTab: null,`, `workspace.ts:112`):

```ts
  secondaryTab: null,
  splitRatio: 0.5,
```

Add the actions (near `setActiveTab`, `workspace.ts:160`):

```ts
  setSecondaryTab: (notePath) => {
    if (notePath === null) {
      set({ secondaryTab: null })
      return
    }
    const { openTabs } = get()
    if (!openTabs.includes(notePath)) {
      set({ openTabs: [...openTabs, notePath] })
    }
    set({ secondaryTab: notePath })
  },

  setSplitRatio: (ratio) => set({ splitRatio: ratio }),
```

Update `closeTab` (`workspace.ts:143-150`) to also clear `secondaryTab`:

```ts
  closeTab: (notePath) => {
    const { openTabs, activeTab, secondaryTab, closedTabs } = get()
    const next = openTabs.filter((p) => p !== notePath)
    const newActive =
      activeTab === notePath ? (next[next.length - 1] ?? null) : activeTab
    const nextClosed = [...closedTabs, notePath].slice(-CLOSED_TABS_CAP)
    set({
      openTabs: next,
      activeTab: newActive,
      secondaryTab: secondaryTab === notePath ? null : secondaryTab,
      closedTabs: nextClosed,
    })
  },
```

Update `closeTabsUnder` (`workspace.ts:202-207`):

```ts
  closeTabsUnder: (prefix) => {
    const { openTabs, activeTab, secondaryTab } = get()
    const next = openTabs.filter((p) => !isUnderPath(p, prefix))
    const newActive = activeTab && isUnderPath(activeTab, prefix) ? (next[next.length - 1] ?? null) : activeTab
    const newSecondary = secondaryTab && isUnderPath(secondaryTab, prefix) ? null : secondaryTab
    set({ openTabs: next, activeTab: newActive, secondaryTab: newSecondary })
  },
```

Update `replaceOpenPath` (`workspace.ts:192-200`):

```ts
  replaceOpenPath: (oldPrefix, newPrefix) => {
    const { openTabs, activeTab, secondaryTab, expandedFolders, selectedFolder } = get()
    set({
      openTabs: openTabs.map((p) => replacePathPrefix(p, oldPrefix, newPrefix)),
      activeTab: activeTab ? replacePathPrefix(activeTab, oldPrefix, newPrefix) : activeTab,
      secondaryTab: secondaryTab ? replacePathPrefix(secondaryTab, oldPrefix, newPrefix) : secondaryTab,
      expandedFolders: expandedFolders.map((p) => replacePathPrefix(p, oldPrefix, newPrefix)),
      selectedFolder: selectedFolder ? replacePathPrefix(selectedFolder, oldPrefix, newPrefix) : selectedFolder,
    })
  },
```

Update `resetForNewWorkspace` (`workspace.ts:238-258`) to add `secondaryTab: null, splitRatio: 0.5,` alongside the existing `activeTab: null,` line.

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npm test -- workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add src/store/workspace.ts src/store/workspace.test.ts
git commit -m "feat(workspace): add secondaryTab/splitRatio to the workspace store"
```

---

### Task 3: Persist `secondaryTab`/`splitRatio` — TS type and Rust model

**Files:**
- Modify: `src/types/index.ts:52-58`
- Modify: `src-tauri/src/models.rs:95-116`
- Test: `src-tauri/src/commands/workspace.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `WorkspaceState.secondaryTab?: string | null`, `WorkspaceState.splitRatio?: number` (TS); `WorkspaceState.secondary_tab: Option<String>`, `WorkspaceState.split_ratio: Option<f64>` (Rust, serialized as `secondaryTab`/`splitRatio` via the struct's existing `#[serde(rename_all = "camelCase")]`).

- [ ] **Step 1: Write the failing Rust tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/commands/workspace.rs` (near `test_git_config_roundtrips`):

```rust
#[tokio::test]
async fn test_split_pane_state_roundtrips() {
    let dir = tempdir().unwrap();
    let path = dir.path().to_string_lossy().into_owned();
    let original = WorkspaceState {
        secondary_tab: Some("/ws/solution.md".into()),
        split_ratio: Some(0.35),
        ..Default::default()
    };

    save_workspace_to_dir(&path, &original).await.unwrap();
    let loaded = load_workspace_from_dir(&path).await.unwrap();

    assert_eq!(loaded.secondary_tab, original.secondary_tab);
    assert_eq!(loaded.split_ratio, original.split_ratio);
}

// A `.workspace.json` written before split-pane editing shipped has neither
// key at all. It must still load as single-pane, not fail the whole open.
#[tokio::test]
async fn test_load_legacy_file_without_split_pane_fields() {
    let dir = tempdir().unwrap();
    tokio::fs::write(
        dir.path().join(".workspace.json"),
        r#"{"openTabs":[],"activeTab":null}"#,
    )
    .await
    .unwrap();

    let state = load_workspace_from_dir(&dir.path().to_string_lossy())
        .await
        .unwrap();

    assert!(state.secondary_tab.is_none());
    assert!(state.split_ratio.is_none());
}
```

- [ ] **Step 2: Run to confirm it fails**

Run (from `src-tauri/`): `cargo test workspace::tests::test_split_pane_state_roundtrips`
Expected: FAIL — no `secondary_tab`/`split_ratio` fields on `WorkspaceState`.

- [ ] **Step 3: Add the fields in `src-tauri/src/models.rs`**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
    #[serde(default)]
    pub expanded_folders: Vec<String>,
    #[serde(default)]
    pub recent_searches: Vec<String>,
    #[serde(default)]
    pub git: GitWorkspaceConfig,
    // Split-pane editing (#54). Added after `.workspace.json` shipped, so
    // both tolerate their own absence in a file an older build wrote —
    // `None` means "single pane" / "use the default 0.5 ratio", the same
    // posture the frontend already needs for a workspace that was never
    // split at all.
    #[serde(default)]
    pub secondary_tab: Option<String>,
    #[serde(default)]
    pub split_ratio: Option<f64>,
}
```

- [ ] **Step 4: Run to confirm it passes**

Run (from `src-tauri/`): `cargo test workspace::tests`
Expected: PASS (all `workspace.rs` tests, including the two new ones and the pre-existing legacy-load tests)

- [ ] **Step 5: Update the TS type in `src/types/index.ts`**

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

- [ ] **Step 6: Lint, typecheck, and commit**

Run: `cd src-tauri && cargo clippy -- -D warnings && cargo fmt --check` (from `src-tauri/`)
Run: `npm run typecheck` (from repo root)
Expected: both clean

```bash
git add src-tauri/src/models.rs src-tauri/src/commands/workspace.rs src/types/index.ts
git commit -m "feat(workspace): persist secondaryTab/splitRatio in .workspace.json"
```

---

### Task 4: Wire persistence through `useWorkspace`/`useGitConfig`

Both `saveSession` (`src/hooks/useWorkspace.ts:35-39`) and `updateGit` (`src/hooks/useGitConfig.ts:18-27`) build the object passed to `api.workspace.save` by hand, and `openWorkspaceAt` (`useWorkspace.ts:53-116`) restores fields from the loaded session one by one. Missing either call site here would silently drop `secondaryTab`/`splitRatio` to `undefined` on the next save (a Git-config change or any session save would erase an open split without touching either directly).

**Files:**
- Modify: `src/hooks/useWorkspace.ts:35-39,53-116`
- Modify: `src/hooks/useGitConfig.ts:18-27`
- Test: `src/hooks/useWorkspace.test.ts`
- Test: `src/hooks/useGitConfig.test.ts`

**Interfaces:**
- Consumes: `useWorkspaceStore`'s `secondaryTab`, `splitRatio`, `setSecondaryTab`, `setSplitRatio` (Task 2).

- [ ] **Step 1: Write the failing tests**

Add to `src/hooks/useWorkspace.test.ts`:

```ts
it('saveSession persists secondaryTab and splitRatio alongside the rest of the session', async () => {
  useWorkspaceStore.setState({ path: '/ws', secondaryTab: '/ws/b.md', splitRatio: 0.4 })
  const { result } = renderHook(() => useWorkspace())

  await result.current.saveSession()

  expect(workspace.save).toHaveBeenCalledWith(
    '/ws',
    expect.objectContaining({ secondaryTab: '/ws/b.md', splitRatio: 0.4 }),
  )
})

it('openWorkspaceAt restores a saved split-pane layout into the store', async () => {
  workspace.load.mockResolvedValue({ ...emptySession, secondaryTab: '/ws/b.md', splitRatio: 0.4 })
  const { result } = renderHook(() => useWorkspace())

  await result.current.openWorkspaceAt('/ws')

  expect(useWorkspaceStore.getState().secondaryTab).toBe('/ws/b.md')
  expect(useWorkspaceStore.getState().splitRatio).toBe(0.4)
})

it('openWorkspaceAt defaults splitRatio to 0.5 for a session saved before split-pane editing shipped', async () => {
  workspace.load.mockResolvedValue(emptySession)
  const { result } = renderHook(() => useWorkspace())

  await result.current.openWorkspaceAt('/ws')

  expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
  expect(useWorkspaceStore.getState().splitRatio).toBe(0.5)
})
```

Add to `src/hooks/useGitConfig.test.ts`, replacing the exact-match assertion in the existing `'merges the patch into the store and persists the whole session'` test (`useGitConfig.test.ts:41-47`) so it doesn't break on the two new keys `updateGit` will now include:

```ts
    expect(workspace.save).toHaveBeenCalledWith('/ws', {
      openTabs: ['/ws/a.md'],
      activeTab: '/ws/a.md',
      secondaryTab: null,
      splitRatio: 0.5,
      expandedFolders: [],
      recentSearches: [],
      git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
    })
```

- [ ] **Step 2: Run to confirm the new/changed tests fail**

Run: `npm test -- useWorkspace.test.ts useGitConfig.test.ts`
Expected: FAIL — `saveSession`/`updateGit` don't read or send `secondaryTab`/`splitRatio` yet; `openWorkspaceAt` doesn't restore them.

- [ ] **Step 3: Implement in `src/hooks/useWorkspace.ts`**

```ts
  const saveSession = useCallback(async () => {
    const { path, openTabs, activeTab, secondaryTab, splitRatio, expandedFolders, recentSearches, git } =
      useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, { openTabs, activeTab, secondaryTab, splitRatio, expandedFolders, recentSearches, git })
  }, [])
```

In `openWorkspaceAt`, destructure `setSecondaryTab`/`setSplitRatio` from `useWorkspaceStore.getState()` alongside the existing `setExpandedFolders`/`setRecentSearches`/etc. (`useWorkspace.ts:56`), and after `setGit(session.git)` (`useWorkspace.ts:82`) add:

```ts
      setSecondaryTab(session.secondaryTab ?? null)
      setSplitRatio(session.splitRatio ?? 0.5)
```

- [ ] **Step 4: Implement in `src/hooks/useGitConfig.ts`**

```ts
  const updateGit = useCallback(
    async (patch: Partial<GitWorkspaceConfig>) => {
      const { path, git, openTabs, activeTab, secondaryTab, splitRatio, expandedFolders, recentSearches } =
        useWorkspaceStore.getState()
      if (!path) return
      const next = { ...git, ...patch }
      setGit(next)
      await api.workspace.save(path, { openTabs, activeTab, secondaryTab, splitRatio, expandedFolders, recentSearches, git: next })
    },
    [setGit],
  )
```

- [ ] **Step 5: Run to confirm tests pass**

Run: `npm test -- useWorkspace.test.ts useGitConfig.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full frontend suite, typecheck, and commit**

Run: `npm test && npm run typecheck`
Expected: all pass

```bash
git add src/hooks/useWorkspace.ts src/hooks/useGitConfig.ts src/hooks/useWorkspace.test.ts src/hooks/useGitConfig.test.ts
git commit -m "feat(workspace): round-trip secondaryTab/splitRatio through session save/load"
```

---

### Task 5: Extract `EditorPane` from `Layout.tsx`

Pure refactor — the single-pane block currently inline at `Layout.tsx:612-674` (plus `ConflictBar` at `Layout.tsx:569`) becomes a standalone, props-driven component. No behavior changes; `Layout`'s existing tests must pass unmodified, since nothing about what's rendered for a single open tab is supposed to change yet.

**Files:**
- Create: `src/components/EditorPane.tsx`
- Modify: `src/components/Layout.tsx:1-69` (imports, `ViewMode` stays), `569`, `612-674`

**Interfaces:**
- Produces:
  ```ts
  export interface EditorPaneProps {
    notePath: string | null
    content: string
    isLoading: boolean
    saveState: SaveState
    saveError: string | null
    onSave: (markdown: string) => void
    onRetrySave: () => void
    onDismissSaveError: () => void
    conflict: boolean
    onKeepMine: () => void
    onReloadTheirs: () => void
    viewMode: 'wysiwyg' | 'raw'
    onViewModeChange: (mode: 'wysiwyg' | 'raw') => void
    onFlashcardCommand: (editor: Editor, range: Range) => void
    onDiagramCommand?: (editor: Editor, range: Range | null) => void
    onClose?: () => void
    // Only the primary pane shows the pre-workspace picker / empty-workspace
    // state / home dashboard — grouped into one object rather than four
    // separate optional callbacks so EditorPane never needs a non-null
    // assertion to use them (CLAUDE.md flags `!` as an error outside a
    // structurally-impossible null case, and "showEmptyStates is true" isn't
    // something the type system can see on its own).
    emptyState?: {
      onOpenTaskView: () => void
      onOpenReview: () => void
      onOpenDeckView: () => void
      onOpenSettings: () => void
      overlayOpen: boolean
    }
  }
  export const EditorPane: React.ForwardRefExoticComponent<EditorPaneProps & React.RefAttributes<HTMLDivElement>>
  ```
  The forwarded ref attaches to the pane's root `.editor-pane` div — Task 6 passes it only for the primary instance (`OutlinePanel`/`ExportPdfDialog`/`PrintDialog` all need that specific DOM node).
- Consumes: `useSettingsStore`, `useNotesStore`, `useWorkspaceStore` (for `settings`, `notes`/`currentNote`, `workspacePath`/`repoMode`) — read directly inside `EditorPane`, the same way `BacklinksPanel`/`NoteHistoryPanel` already read `useWorkspaceStore` themselves rather than taking it as a prop.

- [ ] **Step 1: Create `src/components/EditorPane.tsx`**

```tsx
import { forwardRef } from 'react'
import type { CSSProperties } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { X } from 'lucide-react'
import { NoteEditor } from '../editor/NoteEditor'
import { RawEditor } from '../editor/RawEditor'
import { BacklinksPanel } from './BacklinksPanel'
import { NoteHistoryPanel } from './NoteHistoryPanel'
import { ConflictBar } from './ConflictBar'
import { LoadingStatus } from './LoadingStatus'
import { WorkspacePicker } from './WorkspacePicker'
import { HomeView } from './HomeView'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore } from '../store/settings'
import type { SaveState } from '../hooks/useNote'

export interface EditorPaneProps {
  notePath: string | null
  content: string
  isLoading: boolean
  saveState: SaveState
  saveError: string | null
  onSave: (markdown: string) => void
  onRetrySave: () => void
  onDismissSaveError: () => void
  conflict: boolean
  onKeepMine: () => void
  onReloadTheirs: () => void
  viewMode: 'wysiwyg' | 'raw'
  onViewModeChange: (mode: 'wysiwyg' | 'raw') => void
  onFlashcardCommand: (editor: Editor, range: Range) => void
  onDiagramCommand?: (editor: Editor, range: Range | null) => void
  // Present only for the secondary pane — its header (view toggle + close)
  // only renders when there's somewhere for "close" to collapse back to.
  onClose?: () => void
  // Only the primary pane shows the pre-workspace picker / empty-workspace
  // state / home dashboard — a second pane is never opened without a note.
  // Grouped into one object (rather than four optional callbacks) so using
  // them never needs a non-null assertion: narrowing on `emptyState &&`
  // proves every field inside it is defined, where four independent
  // optionals would not.
  emptyState?: {
    onOpenTaskView: () => void
    onOpenReview: () => void
    onOpenDeckView: () => void
    onOpenSettings: () => void
    overlayOpen: boolean
  }
}

export const EditorPane = forwardRef<HTMLDivElement, EditorPaneProps>(function EditorPane(
  {
    notePath,
    content,
    isLoading,
    saveState,
    saveError,
    onSave,
    onRetrySave,
    onDismissSaveError,
    conflict,
    onKeepMine,
    onReloadTheirs,
    viewMode,
    onViewModeChange,
    onFlashcardCommand,
    onDiagramCommand,
    onClose,
    emptyState,
  },
  ref,
) {
  const settings = useSettingsStore((s) => s.settings)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const notes = useNotesStore((s) => s.notes)
  const currentNote = notes.find((n) => n.path === notePath)

  return (
    <div className="editor-scroll">
      {conflict && <ConflictBar onKeepMine={onKeepMine} onReloadTheirs={onReloadTheirs} />}
      {onClose && (
        <div className="editor-pane-header">
          <button
            className={`view-toggle${viewMode === 'raw' ? ' active' : ''}`}
            onClick={() => onViewModeChange(viewMode === 'wysiwyg' ? 'raw' : 'wysiwyg')}
            title={viewMode === 'wysiwyg' ? 'View source' : 'View preview'}
          >
            {viewMode === 'wysiwyg' ? 'Source' : 'Preview'}
          </button>
          <button className="pane-close" onClick={onClose} aria-label="Close split pane">
            <X size={12} />
          </button>
        </div>
      )}
      <div
        ref={ref}
        className={`editor-pane${!notePath && !workspacePath ? ' editor-pane--center' : ''}`}
        style={{ '--editor-max-width': `${settings.editorMaxWidthPx}px` } as CSSProperties}
      >
        {isLoading && <LoadingStatus />}
        {!isLoading && notePath && viewMode === 'wysiwyg' && (
          <NoteEditor
            content={content}
            notePath={notePath}
            spellcheck={settings.spellcheck}
            spellcheckLanguage={settings.spellcheckLanguage}
            onChange={onSave}
            onFlashcardCommand={onFlashcardCommand}
            onDiagramCommand={onDiagramCommand}
          />
        )}
        {!isLoading && notePath && viewMode === 'raw' && (
          <RawEditor
            content={content}
            notePath={notePath}
            spellcheck={settings.spellcheck}
            spellcheckLanguage={settings.spellcheckLanguage}
            onChange={onSave}
          />
        )}
        {emptyState && !notePath && !workspacePath && <WorkspacePicker />}
        {emptyState && !notePath && workspacePath && notes.length === 0 && (
          <p className="empty-state">
            Press Ctrl N to create your first note, or press ? for shortcuts
          </p>
        )}
        {emptyState && !notePath && workspacePath && notes.length > 0 && (
          <HomeView
            onOpenTaskView={emptyState.onOpenTaskView}
            onOpenReview={emptyState.onOpenReview}
            onOpenDeckView={emptyState.onOpenDeckView}
            onOpenSettings={emptyState.onOpenSettings}
            overlayOpen={emptyState.overlayOpen}
          />
        )}
        {!isLoading && notePath && currentNote && (
          <BacklinksPanel notePath={notePath} noteTitle={currentNote.title} />
        )}
        {!isLoading && notePath && repoMode && (
          <NoteHistoryPanel
            notePath={notePath}
            saveState={saveState}
            currentContent={content}
            onRestore={onSave}
          />
        )}
      </div>
    </div>
  )
})
```

`saveError`/`onRetrySave`/`onDismissSaveError` are accepted but intentionally unused inside `EditorPane` in this task — `SaveStatus` stays in `TabBar`, tied to the primary tab only (per spec's "Out of scope: independent tab strips per pane" — save status follows the same shared-strip posture). They're threaded through now so Task 6 doesn't need to touch this component's prop list again.

- [ ] **Step 2: Wire `EditorPane` into `Layout.tsx` in place of the inline block**

Remove the `NoteEditor`/`RawEditor` imports from `Layout.tsx` (now only used inside `EditorPane`) and add `import { EditorPane } from './EditorPane'`. Remove the `ConflictBar` render at `Layout.tsx:569` (moved into `EditorPane`) but keep the `ConflictBar` import removed only if nothing else in `Layout.tsx` uses it — it doesn't, so remove that import too.

Replace `Layout.tsx:612-674` with:

```tsx
        <div className="editor-body">
          <div className="pane-wrapper">
            <EditorPane
              ref={editorPaneRef}
              notePath={activeTab}
              content={content}
              isLoading={isLoading}
              saveState={saveState}
              saveError={saveError}
              onSave={(md) => void save(md)}
              onRetrySave={retrySave}
              onDismissSaveError={dismissError}
              conflict={conflict}
              onKeepMine={keepMine}
              onReloadTheirs={reloadTheirs}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onFlashcardCommand={handleFlashcardCommand}
              onDiagramCommand={handleDiagramCommand}
              emptyState={{
                onOpenTaskView: () => openOverlay('task'),
                onOpenReview: () => {
                  setPendingCram(null)
                  openOverlay('review')
                },
                onOpenDeckView: () => openOverlay('deck'),
                onOpenSettings: () => openOverlay('settings'),
                overlayOpen: activeOverlay !== null,
              }}
            />
            {!isLoading && activeTab && viewMode === 'wysiwyg' && outlineOpen && (
              <OutlinePanel content={content} containerRef={editorPaneRef} />
            )}
          </div>
        </div>
```

Note this drops the old `.editor-scroll`+`ref={scrollRef}` wrapper from `Layout.tsx` — `useScrollRestoration`'s ref now needs to attach to the `.editor-scroll` div `EditorPane` itself renders. Since `EditorPane` only forwards its ref to the inner `.editor-pane` div (needed for `OutlinePanel`/export/print), give `EditorPane` a second, optional way to receive the scroll ref: change its outermost `<div className="editor-scroll">` to accept the scroll ref via a new prop.

Add to `EditorPaneProps`:

```ts
  scrollRef?: React.RefObject<HTMLDivElement | null>
```

And in the component, spread it onto the outer div: `<div className="editor-scroll" ref={scrollRef}>`. Then in `Layout.tsx`, pass `scrollRef={scrollRef}` on the primary `<EditorPane>` (the existing `scrollRef` from `useScrollRestoration(activeTab, isLoading, viewMode)` at `Layout.tsx:131` is unchanged).

- [ ] **Step 3: Add the two small CSS rules this extraction needs**

`EditorPane`'s secondary-only header and close button don't exist as CSS yet (they're inert until Task 6 ever passes `onClose`, but adding the rules now keeps this task's diff self-contained). Add to `src/index.css`, near `.tab-close` (`index.css:2469`):

```css
.pane-wrapper {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.editor-pane-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.editor-pane-header .pane-close {
  padding: 4px;
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
}

.editor-pane-header .pane-close:hover { color: var(--danger); }
```

Also move `.editor-body`'s `position: relative` responsibility: `.editor-body` (`index.css:486-492`) keeps its `display:flex; flex:1; min-height:0; overflow:hidden`, since `.pane-wrapper` (new) is now what needs `position: relative` for `OutlinePanel`'s absolutely-positioned overlay to anchor against. `.editor-body` itself doesn't declare `position: relative` today, so no removal is needed there — just confirm (visually, via Step 4) that `OutlinePanel` still lines up now that its positioning ancestor is `.pane-wrapper` instead of `.editor-body` directly.

- [ ] **Step 4: Run the existing test suite and typecheck**

Run: `npm test -- Layout.test.tsx`
Expected: PASS, unmodified — this step is the actual verification that the refactor changed nothing observable.

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Manual check via the dev server**

Run: `npm run dev`, open a workspace, open a note, confirm: the note renders, typing saves (status indicator updates), the Source/Preview toggle still swaps views, the outline panel still lines up against the note column, and Ctrl+P / print still capture the note (spot-check one, not both, is enough here — Task 6 is the one actually touching split behavior).

- [ ] **Step 6: Commit**

```bash
git add src/components/EditorPane.tsx src/components/Layout.tsx src/index.css
git commit -m "refactor(editor): extract EditorPane from Layout's single-pane render block"
```

---

### Task 6: Render a second pane and a resizable divider

**Files:**
- Modify: `src/components/Layout.tsx`
- Test: `src/components/Layout.test.tsx`

**Interfaces:**
- Consumes: `secondaryTab`, `splitRatio`, `setSecondaryTab`, `setSplitRatio` from `useWorkspaceStore` (Task 2); `EditorPane` (Task 5).

- [ ] **Step 1: Write the failing test**

Add to `src/components/Layout.test.tsx`:

```ts
describe('Layout split-pane rendering', () => {
  it('renders two note editors side by side when secondaryTab is set', () => {
    useWorkspaceStore.setState({
      path: '/ws',
      activeTab: '/ws/a.md',
      secondaryTab: '/ws/b.md',
      splitRatio: 0.5,
      tagFilter: null,
    })
    useNotesStore.setState({
      notes: [
        { id: '1', path: '/ws/a.md', title: 'a', workspace: '/ws', updatedAt: 0 },
        { id: '2', path: '/ws/b.md', title: 'b', workspace: '/ws', updatedAt: 0 },
      ],
      folders: [],
      tags: [],
    })

    render(<Layout />)

    expect(document.querySelectorAll('.pane-wrapper')).toHaveLength(2)
    expect(document.querySelector('.pane-divider')).toBeInTheDocument()
  })

  it('closing the secondary pane collapses back to a single pane', () => {
    useWorkspaceStore.setState({
      path: '/ws',
      activeTab: '/ws/a.md',
      secondaryTab: '/ws/b.md',
      splitRatio: 0.5,
      tagFilter: null,
    })
    useNotesStore.setState({
      notes: [
        { id: '1', path: '/ws/a.md', title: 'a', workspace: '/ws', updatedAt: 0 },
        { id: '2', path: '/ws/b.md', title: 'b', workspace: '/ws', updatedAt: 0 },
      ],
      folders: [],
      tags: [],
    })

    render(<Layout />)
    fireEvent.click(screen.getByLabelText('Close split pane'))

    expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
    expect(document.querySelectorAll('.pane-wrapper')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- Layout.test.tsx`
Expected: FAIL — only one `.pane-wrapper` ever renders yet, no `.pane-divider`, no "Close split pane" button reachable outside a pane that has `onClose`.

- [ ] **Step 3: Implement in `Layout.tsx`**

Rename the existing `viewMode`/`setViewMode` (`Layout.tsx:114`) to `primaryViewMode`/`setPrimaryViewMode` (update the two other read sites: the `toggle-view` command at `Layout.tsx:244`, `export-pdf`/`print` commands at `Layout.tsx:259,264`, and `useScrollRestoration`'s third argument at `Layout.tsx:131`). Add secondary pane state next to it:

```ts
  const [primaryViewMode, setPrimaryViewMode] = useState<ViewMode>('wysiwyg')
  const [secondaryViewMode, setSecondaryViewMode] = useState<ViewMode>('wysiwyg')
  const secondaryTab = useWorkspaceStore((s) => s.secondaryTab)
  const setSecondaryTab = useWorkspaceStore((s) => s.setSecondaryTab)
  const splitRatio = useWorkspaceStore((s) => s.splitRatio)
  const setSplitRatio = useWorkspaceStore((s) => s.setSplitRatio)
  const paneContainerRef = useRef<HTMLDivElement>(null)
  const {
    content: secondaryContent,
    save: saveSecondary,
    isLoading: secondaryLoading,
    saveState: secondarySaveState,
    saveError: secondarySaveError,
    retrySave: retrySecondarySave,
    dismissError: dismissSecondaryError,
    conflict: secondaryConflict,
    keepMine: keepMineSecondary,
    reloadTheirs: reloadTheirsSecondary,
  } = useNote(secondaryTab)
```

Add the divider-drag handler, near the other `useCallback`s:

```ts
  const startPaneResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = paneContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const onMove = (moveEvent: MouseEvent) => {
      const ratio = (moveEvent.clientX - rect.left) / rect.width
      setSplitRatio(Math.min(0.8, Math.max(0.2, ratio)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [setSplitRatio])
```

Replace the `editor-body` block from Task 5 with:

```tsx
        <div className="editor-body" ref={paneContainerRef}>
          <div className="pane-wrapper" style={secondaryTab ? { flex: `0 0 ${splitRatio * 100}%` } : undefined}>
            <EditorPane
              ref={editorPaneRef}
              scrollRef={scrollRef}
              notePath={activeTab}
              content={content}
              isLoading={isLoading}
              saveState={saveState}
              saveError={saveError}
              onSave={(md) => void save(md)}
              onRetrySave={retrySave}
              onDismissSaveError={dismissError}
              conflict={conflict}
              onKeepMine={keepMine}
              onReloadTheirs={reloadTheirs}
              viewMode={primaryViewMode}
              onViewModeChange={setPrimaryViewMode}
              onFlashcardCommand={handleFlashcardCommand}
              onDiagramCommand={handleDiagramCommand}
              emptyState={{
                onOpenTaskView: () => openOverlay('task'),
                onOpenReview: () => {
                  setPendingCram(null)
                  openOverlay('review')
                },
                onOpenDeckView: () => openOverlay('deck'),
                onOpenSettings: () => openOverlay('settings'),
                overlayOpen: activeOverlay !== null,
              }}
            />
            {!isLoading && activeTab && primaryViewMode === 'wysiwyg' && outlineOpen && (
              <OutlinePanel content={content} containerRef={editorPaneRef} />
            )}
          </div>
          {secondaryTab && (
            <>
              <div className="pane-divider" onMouseDown={startPaneResize} />
              <div className="pane-wrapper" style={{ flex: `0 0 ${(1 - splitRatio) * 100}%` }}>
                <EditorPane
                  notePath={secondaryTab}
                  content={secondaryContent}
                  isLoading={secondaryLoading}
                  saveState={secondarySaveState}
                  saveError={secondarySaveError}
                  onSave={(md) => void saveSecondary(md)}
                  onRetrySave={retrySecondarySave}
                  onDismissSaveError={dismissSecondaryError}
                  conflict={secondaryConflict}
                  onKeepMine={keepMineSecondary}
                  onReloadTheirs={reloadTheirsSecondary}
                  viewMode={secondaryViewMode}
                  onViewModeChange={setSecondaryViewMode}
                  onFlashcardCommand={handleFlashcardCommand}
                  onDiagramCommand={handleDiagramCommand}
                  onClose={() => setSecondaryTab(null)}
                />
              </div>
            </>
          )}
        </div>
```

Add the close-requested handler's second flush (`Layout.tsx:135-147`) — every pending write must reach disk before the window is allowed to close, and now there are two:

```ts
    const unlisten = listen('close-requested', async () => {
      try {
        await flush()
        await flushSecondary()
        await saveSession()
        await flushGitCommit()
      } finally {
        await api.terminal.close()
        await api.window.confirmClose()
      }
    })
```

(`flushSecondary` is `useNote(secondaryTab)`'s `flush`, destructured into the block above alongside `secondaryContent` etc. — add it to that destructuring list and to the `useEffect`'s dependency array alongside `flush`.)

Add the divider CSS to `src/index.css`, near `.pane-wrapper` (added in Task 5):

```css
.pane-divider {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: var(--border);
}

.pane-divider:hover { background: var(--accent); }
```

- [ ] **Step 4: Run to confirm the tests pass**

Run: `npm test -- Layout.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass — this is where a stale `viewMode` reference (missed in the rename) or an unbalanced prop would surface.

- [ ] **Step 6: Manual check**

Run: `npm run dev`. With `useWorkspaceStore.getState().setSecondaryTab('<some open note path>')` invoked from the browser devtools console (no drag gesture yet — that's Task 7), confirm: two notes render side by side, each has its own Source/Preview toggle, dragging the divider resizes both panes, and the secondary pane's × collapses back to one pane.

- [ ] **Step 7: Commit**

```bash
git add src/components/Layout.tsx src/index.css src/components/Layout.test.tsx
git commit -m "feat(editor): render a second pane and resizable divider when secondaryTab is set"
```

---

### Task 7: Drag a tab to the right edge to open the split

**Files:**
- Modify: `src/components/TabBar.tsx:59`
- Modify: `src/components/Layout.tsx`
- Test: `src/components/TabBar.test.tsx` (create if it doesn't exist — check first)
- Test: `e2e/specs/split-pane-drag.e2e.ts`

**Interfaces:**
- No new exports — this wires native `DataTransfer` (already used for tab reordering in `TabBar.tsx:59-66`) through to a new drop target in `Layout.tsx`.

- [ ] **Step 1: Check for an existing `TabBar.test.tsx`**

Run: `ls src/components/TabBar.test.tsx 2>/dev/null || echo "none"`. If it exists, add the test below to it; if not, this step's test becomes the reason to create one.

- [ ] **Step 2: Write the failing unit test**

`src/components/TabBar.test.tsx` (new file, or appended to the existing one):

```ts
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { TabBar } from './TabBar'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

afterEach(cleanup)
beforeEach(() => {
  useWorkspaceStore.setState({ openTabs: ['/ws/a.md', '/ws/b.md'], activeTab: '/ws/a.md', flashTabPath: null })
  useNotesStore.setState({
    notes: [
      { id: '1', path: '/ws/a.md', title: 'a', workspace: '/ws', updatedAt: 0 },
      { id: '2', path: '/ws/b.md', title: 'b', workspace: '/ws', updatedAt: 0 },
    ],
    folders: [],
    tags: [],
  })
})

const noop = () => {}

describe('TabBar drag payload', () => {
  it('sets the note path as plain-text drag data on dragstart, for drop targets outside the tab strip', () => {
    const { getByText } = render(
      <TabBar
        viewMode="wysiwyg"
        onToggleView={noop}
        saveState="clean"
        saveError={null}
        onRetrySave={noop}
        onDismissSaveError={noop}
        gitCommitStatus="idle"
        gitCommitDetail={null}
        onSyncNow={noop}
        syncingNow={false}
      />,
    )
    const tab = getByText('b').closest('[role="tab"]') as HTMLElement
    const dataTransfer = new DataTransfer()

    fireEvent.dragStart(tab, { dataTransfer })

    expect(dataTransfer.getData('text/plain')).toBe('/ws/b.md')
  })
})
```

- [ ] **Step 3: Run to confirm it fails**

Run: `npm test -- TabBar.test.tsx`
Expected: FAIL — `dataTransfer.getData('text/plain')` is empty.

- [ ] **Step 4: Set the drag payload in `TabBar.tsx`**

Change `TabBar.tsx:59`:

```tsx
              onDragStart={(e) => {
                setDraggedPath(path)
                e.dataTransfer.setData('text/plain', path)
              }}
```

- [ ] **Step 5: Run to confirm it passes**

Run: `npm test -- TabBar.test.tsx`
Expected: PASS

- [ ] **Step 6: Add the drop zone to `Layout.tsx`**

Add state and handlers near the other `useState`s/`useCallback`s:

```ts
  const [splitDropZoneActive, setSplitDropZoneActive] = useState(false)

  const handleEditorDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('text/plain')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const inZone = e.clientX > rect.left + rect.width * 0.75
    if (inZone) e.preventDefault()
    setSplitDropZoneActive(inZone)
  }, [])

  const handleEditorDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setSplitDropZoneActive(false)
  }, [])

  const handleEditorDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const path = e.dataTransfer.getData('text/plain')
      setSplitDropZoneActive(false)
      if (!path) return
      e.preventDefault()
      setSecondaryTab(path)
    },
    [setSecondaryTab],
  )
```

Wire them onto `.editor-body` and add the visual drop-zone overlay, only shown while a tab is being dragged over the zone and there's an active tab to be dragging in the first place:

```tsx
        <div
          className="editor-body"
          ref={paneContainerRef}
          onDragOver={handleEditorDragOver}
          onDragLeave={handleEditorDragLeave}
          onDrop={handleEditorDrop}
        >
          {splitDropZoneActive && <div className="split-drop-zone" />}
          <div className="pane-wrapper" ...>
```

(The rest of the block is unchanged from Task 6.)

Add the overlay CSS to `src/index.css`, near `.pane-divider`:

```css
.split-drop-zone {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 25%;
  background: var(--accent-bg-hover);
  border-left: 2px solid var(--accent);
  pointer-events: none;
  z-index: 1;
}
```

`.editor-body` needs `position: relative` for this overlay to anchor correctly — add it to the existing `.editor-body` rule (`index.css:486-492`) if it isn't already implied by the flex layout (it isn't; `position: relative` must be explicit).

- [ ] **Step 7: Typecheck and manually verify**

Run: `npm run typecheck`
Expected: no errors

Run: `npm run dev`, open two notes as tabs, drag the second tab toward the right edge of the editor area, confirm the accent-colored drop zone appears only in the right quarter, and dropping there opens the split without changing which tab is primary.

- [ ] **Step 8: Write the e2e test**

`e2e/specs/split-pane-drag.e2e.ts` (note-creation steps copied from `e2e/specs/create-note.e2e.ts`'s own pattern; drag simulation copied from `e2e/specs/folder-dnd.e2e.ts`'s `DataTransfer`-based approach):

```ts
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

async function createNote(title: string): Promise<void> {
  await clickInPage('.sidebar-new-actions button')
  await fillPromptDialog(title)
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: `editor never mounted for "${title}"`,
  })
}

// Same real-DataTransfer sequence as folder-dnd.e2e.ts's dragNoteByLabelTo,
// but the drop point matters here — it has to land inside the right-edge
// zone Layout.tsx checks via clientX, not just anywhere on the target.
async function dragTabToRightEdge(tabLabel: string): Promise<void> {
  await browser.execute((label) => {
    const source = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (el) => el.querySelector('button')?.textContent === label,
    )
    const target = document.querySelector('.editor-body')
    if (!source) throw new Error(`drag source tab not found: ${label}`)
    if (!(target instanceof HTMLElement)) throw new Error('.editor-body not found')
    const rect = target.getBoundingClientRect()
    const dropX = rect.left + rect.width * 0.9
    const dropY = rect.top + rect.height / 2
    const dataTransfer = new DataTransfer()
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    target.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: dropX, clientY: dropY }),
    )
    target.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: dropX, clientY: dropY }),
    )
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
  }, tabLabel)
}

describe('split-pane editing: drag a tab to the right edge', () => {
  beforeEach(() => {
    // fixtureWorkspace is a fixed, shared path — clear notes a previous failed
    // run may have left behind so note creation here starts from a clean slate.
    rmSync(join(fixtureWorkspace, 'First.md'), { force: true })
    rmSync(join(fixtureWorkspace, 'Second.md'), { force: true })
  })

  it('opens a second note beside the first, and the close button collapses it back', async () => {
    await createNote('First')
    await createNote('Second')

    await dragTabToRightEdge('Second')

    await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.pane-wrapper').length === 2), {
      timeout: 5000,
      timeoutMsg: 'dragging the second tab to the right edge never opened a split',
    })

    await clickInPage('[aria-label="Close split pane"]')

    await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.pane-wrapper').length === 1), {
      timeout: 5000,
      timeoutMsg: 'closing the secondary pane never collapsed back to one pane',
    })
  })
})
```

- [ ] **Step 9: Run the e2e spec**

Run: `npm run test:e2e -- --spec e2e/specs/split-pane-drag.e2e.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/components/TabBar.tsx src/components/Layout.tsx src/index.css src/components/TabBar.test.tsx e2e/specs/split-pane-drag.e2e.ts
git commit -m "feat(editor): drag a tab to the editor's right edge to open a split pane"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full frontend suite**

Run: `npm test`
Expected: all pass

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Rust suite, clippy, fmt**

Run (from `src-tauri/`): `cargo test && cargo clippy -- -D warnings && cargo fmt --check`
Expected: all clean

- [ ] **Step 4: Full e2e suite**

Run: `npm run test:e2e`
Expected: all pass, including the new `split-pane-drag.e2e.ts`

- [ ] **Step 5: Manual walkthrough against the spec's driving use case**

Run: `npm run tauri dev`. Import a PDF exercise sheet (or open any existing note) as the primary pane, drag a second note (the worked solution) to the right edge, confirm: both stay independently scrollable and editable, toggling one pane's view mode doesn't affect the other, closing the app and reopening the workspace restores the same split (position and ratio), and closing the secondary pane's × leaves the primary note untouched.

- [ ] **Step 6: Update `CLAUDE.md` if warranted**

If anything here turned out to be a durable fact worth documenting for future agents (e.g. the `EditorPane` extraction pattern, or the focused-editor guard from Task 1), consider running the `sync-agent-docs` skill — this plan doesn't mandate a specific addition, since `CLAUDE.md`'s existing React/TipTap sections already cover the relevant conventions this feature follows rather than changes.
