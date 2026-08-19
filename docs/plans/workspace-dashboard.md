# Workspace Dashboard (P9-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add a Home dashboard that shows Continue/Recent/Tasks/Study/Git sections in the main pane whenever no note is active, reachable both implicitly (no tab restored) and explicitly (a new `Ctrl+H` command).

**Architecture:** `Layout.tsx`'s existing `!activeTab` main-pane branch renders a new `HomeView` component instead of today's plain empty-state text. A new `home` menu command clears the active tab (`setActiveTab(null)`) without closing any open tabs. Every dashboard section reads state or calls APIs that already exist elsewhere in the app (`openTabs`, `notes`, `listOpenTasks`, the Git store fields) — no new store fields, database columns, or Tauri commands.

**Tech Stack:** React 19 + TypeScript (strict), Zustand, Vitest + React Testing Library, Tauri 2 (one native menu item in Rust).

**Spec:** `docs/specs/workspace-dashboard-design.md`

## Global Constraints

- No new derived state, database table, or Tauri command — every section reads data another phase already computes and stores (from the spec's "Sections").
- The explicit Home command must not close any open tab — it only clears which one is active.
- `Ctrl+H` must not collide with an existing accelerator (confirmed unused in `src-tauri/src/lib.rs`'s `build_menu`).
- Section item caps: 5 for Continue, 5 for Recent, 5 for the Tasks preview list (from the spec).
- Study renders as a static disabled placeholder with no fetch — real data arrives with P9-3, not this task.

---

### Task 1: Widen `setActiveTab` to accept `null`

**Files:**
- Modify: `src/store/workspace.ts:33` (interface), `src/store/workspace.ts:109` (implementation)
- Test: `src/store/workspace.test.ts`

**Interfaces:**
- Produces: `useWorkspaceStore.getState().setActiveTab: (notePath: string | null) => void` — used by Task 3's Home command and by every other existing caller (`TabBar`, `TreeNode`, `useCreateNote`, etc.), all of which already only ever pass a `string`.

- [ ] **Step 1: Write the failing test**

Add to `src/store/workspace.test.ts`, alongside the existing `setActiveTab`-adjacent tests (near the `closeTab` tests):

```ts
  it('setActiveTab accepts null to clear the active tab without closing any open tab', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().setActiveTab(null)
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md', '/ws/b.md'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/store/workspace.test.ts`
Expected: FAIL — TypeScript error, `Argument of type 'null' is not assignable to parameter of type 'string'`.

- [ ] **Step 3: Widen the type and implementation**

In `src/store/workspace.ts`, change the interface line:

```ts
  setActiveTab: (notePath: string | null) => void
```

and the implementation:

```ts
  setActiveTab: (notePath) => set({ activeTab: notePath }),
```

(The implementation body is already just `set({ activeTab: notePath })` — only the type annotation on the interface needs to change; `notePath`'s inferred type in the implementation follows the interface automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/store/workspace.test.ts`
Expected: PASS, all existing cases in this file still pass too.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms every existing caller of `setActiveTab` — which all pass a `string` — still type-checks against the widened signature).

- [ ] **Step 6: Commit**

```bash
git add src/store/workspace.ts src/store/workspace.test.ts
git commit -m "feat(p9-4): allow clearing the active tab via setActiveTab(null)"
```

---

### Task 2: Build the `HomeView` component

**Files:**
- Create: `src/components/HomeView.tsx`
- Test: `src/components/HomeView.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaceStore` (`openTabs: string[]`, `setActiveTab: (path: string | null) => void`, `openTab: (path: string) => void`, `repoMode: RepoMode | null`, `gitDiverged: { ahead: number; behind: number } | null`, `gitPendingPaths: string[]`, `path: string | null` as `workspacePath`), `useNotesStore` (`notes: NoteMetadata[]`), `api.notes.listOpenTasks(workspace: string): Promise<OpenTask[]>` (`src/lib/tauri.ts:60-61`).
- Produces: `export function HomeView({ onOpenTaskView }: { onOpenTaskView: () => void }): JSX.Element` — consumed by Task 3's `Layout.tsx` wiring.

This is the core deliverable; work through each section test-first, committing after each.

- [ ] **Step 1: Write the failing test for Continue + Recent (the two synchronous, non-fetching sections)**

Create `src/components/HomeView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeView } from './HomeView'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { listOpenTasks: vi.fn() },
  },
}))

const listOpenTasks = vi.mocked(api.notes.listOpenTasks)

const resetWorkspace = () =>
  useWorkspaceStore.setState({
    path: '/ws',
    openTabs: [],
    activeTab: null,
    repoMode: null,
    gitDiverged: null,
    gitPendingPaths: [],
  })

beforeEach(() => {
  resetWorkspace()
  useNotesStore.setState({ notes: [], folders: [], tags: [] })
  listOpenTasks.mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('HomeView', () => {
  it('lists open tabs under Continue, most-recently-opened first, and activates one on click', async () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')

    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)

    const items = [getByText('a'), getByText('b')]
    expect(items[0]).toBeInTheDocument()
    expect(items[1]).toBeInTheDocument()

    await userEvent.click(getByText('b'))
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md', '/ws/b.md'])
  })

  it('shows an empty hint under Continue when no tabs are open', () => {
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText('No open notes.')).toBeInTheDocument()
  })

  it('lists notes under Recent sorted by most recently updated, and opens one on click', async () => {
    useNotesStore.setState({
      notes: [
        { id: '1', title: 'Older', path: '/ws/older.md', workspace: '/ws', updatedAt: 1 },
        { id: '2', title: 'Newer', path: '/ws/newer.md', workspace: '/ws', updatedAt: 2 },
      ],
      folders: [],
      tags: [],
    })

    const { getByText, getAllByRole } = render(<HomeView onOpenTaskView={() => {}} />)
    const recentSection = getByText('Recent').closest('section')!
    const buttons = getAllByRole('button', { name: /Older|Newer/ })
    expect(recentSection.contains(buttons[0])).toBe(true)
    expect(buttons[0]).toHaveTextContent('Newer')
    expect(buttons[1]).toHaveTextContent('Older')

    await userEvent.click(getByText('Newer'))
    expect(useWorkspaceStore.getState().openTabs).toContain('/ws/newer.md')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/newer.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/HomeView.test.tsx`
Expected: FAIL — `Cannot find module './HomeView'`.

- [ ] **Step 3: Write the minimal implementation for Continue + Recent**

Create `src/components/HomeView.tsx`:

```tsx
import { useMemo } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

const SECTION_CAP = 5

function tabLabel(path: string): string {
  return path.split(/[\\/]/).pop()?.replace('.md', '') ?? path
}

interface HomeViewProps {
  onOpenTaskView: () => void
}

export function HomeView({ onOpenTaskView }: HomeViewProps) {
  const openTabs = useWorkspaceStore((s) => s.openTabs)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const notes = useNotesStore((s) => s.notes)

  const continueItems = useMemo(
    () => [...openTabs].reverse().slice(0, SECTION_CAP),
    [openTabs],
  )
  const recentItems = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SECTION_CAP),
    [notes],
  )

  return (
    <div className="home-view">
      <section className="home-section">
        <h2>Continue</h2>
        {continueItems.length === 0 ? (
          <p className="home-empty">No open notes.</p>
        ) : (
          <ul>
            {continueItems.map((path) => (
              <li key={path}>
                <button className="home-section-item" onClick={() => setActiveTab(path)}>
                  {tabLabel(path)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="home-section">
        <h2>Recent</h2>
        {recentItems.length === 0 ? (
          <p className="home-empty">No notes yet.</p>
        ) : (
          <ul>
            {recentItems.map((note) => (
              <li key={note.path}>
                <button className="home-section-item" onClick={() => openTab(note.path)}>
                  {note.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/HomeView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/HomeView.tsx src/components/HomeView.test.tsx
git commit -m "feat(p9-4): add HomeView Continue and Recent sections"
```

- [ ] **Step 6: Write the failing test for Tasks**

Add to `src/components/HomeView.test.tsx`, inside the `describe('HomeView', ...)` block:

```tsx
  it('shows an open-task count and preview list under Tasks, opening a note on click', async () => {
    listOpenTasks.mockResolvedValue([
      { notePath: '/ws/a.md', noteTitle: 'A', text: 'Finish proof', position: 0 },
      { notePath: '/ws/b.md', noteTitle: 'B', text: 'Review notes', position: 3 },
    ])

    const { findByText, getByText } = render(<HomeView onOpenTaskView={() => {}} />)

    expect(await findByText('2 open')).toBeInTheDocument()
    expect(getByText('Finish proof')).toBeInTheDocument()

    await userEvent.click(getByText('Finish proof'))
    expect(useWorkspaceStore.getState().openTabs).toContain('/ws/a.md')
  })

  it('shows an empty hint under Tasks when there are none', async () => {
    listOpenTasks.mockResolvedValue([])
    const { findByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(await findByText('No open tasks.')).toBeInTheDocument()
  })

  it('opens the full task view from "View all"', async () => {
    listOpenTasks.mockResolvedValue([
      { notePath: '/ws/a.md', noteTitle: 'A', text: 'Finish proof', position: 0 },
    ])
    const onOpenTaskView = vi.fn()
    const { findByText, getByText } = render(<HomeView onOpenTaskView={onOpenTaskView} />)

    await findByText('Finish proof')
    await userEvent.click(getByText('View all'))
    expect(onOpenTaskView).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- src/components/HomeView.test.tsx`
Expected: FAIL — "Unable to find an element with the text: 2 open" (Tasks section doesn't exist yet).

- [ ] **Step 8: Add the Tasks section**

In `src/components/HomeView.tsx`, add the imports and state:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import type { OpenTask } from '../types'
```

Inside `HomeView`, after the existing `notes`/`continueItems`/`recentItems` declarations, add:

```tsx
  const workspacePath = useWorkspaceStore((s) => s.path)
  const [tasks, setTasks] = useState<OpenTask[]>([])

  useEffect(() => {
    if (!workspacePath) return
    api.notes.listOpenTasks(workspacePath).then(setTasks)
  }, [workspacePath])

  const taskItems = tasks.slice(0, SECTION_CAP)
```

And add a new `<section>` after the Recent section's closing `</section>`:

```tsx
      <section className="home-section">
        <h2>Tasks</h2>
        {tasks.length === 0 ? (
          <p className="home-empty">No open tasks.</p>
        ) : (
          <>
            <p className="home-count">{tasks.length} open</p>
            <ul>
              {taskItems.map((task) => (
                <li key={`${task.notePath}:${task.position}`}>
                  <button className="home-section-item" onClick={() => openTab(task.notePath)}>
                    {task.text}
                  </button>
                </li>
              ))}
            </ul>
            <button className="home-view-all" onClick={onOpenTaskView}>
              View all
            </button>
          </>
        )}
      </section>
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- src/components/HomeView.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 10: Commit**

```bash
git add src/components/HomeView.tsx src/components/HomeView.test.tsx
git commit -m "feat(p9-4): add HomeView Tasks section"
```

- [ ] **Step 11: Write the failing test for Study + Git**

Add to `src/components/HomeView.test.tsx`:

```tsx
  it('shows Study as a disabled placeholder', () => {
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText("Spaced repetition isn't set up yet.")).toBeInTheDocument()
  })

  it('hides the Git section when the workspace is not a Git repo', () => {
    useWorkspaceStore.setState({ repoMode: null })
    const { queryByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(queryByText('Git')).not.toBeInTheDocument()
  })

  it('shows "Up to date" when there is no divergence and nothing pending', () => {
    useWorkspaceStore.setState({ repoMode: 'notesOnly', gitDiverged: null, gitPendingPaths: [] })
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText('Up to date')).toBeInTheDocument()
  })

  it('shows an unpushed count when paths are pending and there is no divergence', () => {
    useWorkspaceStore.setState({
      repoMode: 'notesOnly',
      gitDiverged: null,
      gitPendingPaths: ['/ws/a.md', '/ws/b.md'],
    })
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText('2 unpushed')).toBeInTheDocument()
  })

  it('shows the ahead/behind count when diverged, taking priority over pending paths', () => {
    useWorkspaceStore.setState({
      repoMode: 'notesOnly',
      gitDiverged: { ahead: 1, behind: 3 },
      gitPendingPaths: ['/ws/a.md'],
    })
    const { getByText } = render(<HomeView onOpenTaskView={() => {}} />)
    expect(getByText('1 ahead, 3 behind')).toBeInTheDocument()
  })
```

- [ ] **Step 12: Run test to verify it fails**

Run: `npm test -- src/components/HomeView.test.tsx`
Expected: FAIL — Study/Git text not found.

- [ ] **Step 13: Add the Study and Git sections**

In `src/components/HomeView.tsx`, add to the store selectors:

```tsx
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const gitDiverged = useWorkspaceStore((s) => s.gitDiverged)
  const gitPendingPaths = useWorkspaceStore((s) => s.gitPendingPaths)
```

Add, near the other derived values (after `taskItems`):

```tsx
  const gitStatus = !repoMode
    ? null
    : gitDiverged
      ? `${gitDiverged.ahead} ahead, ${gitDiverged.behind} behind`
      : gitPendingPaths.length > 0
        ? `${gitPendingPaths.length} unpushed`
        : 'Up to date'
```

Add two more sections after the Tasks section's closing `</section>`, before the closing `</div>`:

```tsx
      <section className="home-section home-section-disabled">
        <h2>Study</h2>
        <p className="home-empty">Spaced repetition isn't set up yet.</p>
      </section>
      {gitStatus && (
        <section className="home-section">
          <h2>Git</h2>
          <p className="home-status">{gitStatus}</p>
        </section>
      )}
```

- [ ] **Step 14: Run test to verify it passes**

Run: `npm test -- src/components/HomeView.test.tsx`
Expected: PASS (11 tests total).

- [ ] **Step 15: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 16: Commit**

```bash
git add src/components/HomeView.tsx src/components/HomeView.test.tsx
git commit -m "feat(p9-4): add HomeView Study placeholder and Git status sections"
```

---

### Task 3: Wire `HomeView` into the app (Layout, menu command, shortcuts, CSS)

**Files:**
- Modify: `src/components/Layout.tsx` (import, store selector, `runCommand` switch + deps, empty-state branch)
- Modify: `src-tauri/src/lib.rs` (`build_menu`'s `view_menu`)
- Modify: `src/components/ShortcutsOverlay.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `HomeView` from Task 2 (`{ onOpenTaskView: () => void }`), `setActiveTab: (path: string | null) => void` from Task 1.
- Produces: the `home` menu-action id, dispatched identically to every other entry in `Layout.tsx`'s `runCommand` — consumed by Task 4's e2e spec via `window.__e2eRunCommand('home')`.

This task has no isolated unit test of its own — `Layout.tsx`'s `runCommand` dispatcher is exercised only through the native menu and `window.__e2eRunCommand` (see the comment at `Layout.tsx:213-217`, the same reason `graph-view`/`toggle-terminal` have no unit test). Task 4's e2e spec is the test cycle for this task; verify manually with `npm run tauri dev` before moving on.

- [ ] **Step 1: Add the `home` menu item in Rust**

In `src-tauri/src/lib.rs`, inside `build_menu`'s `view_menu` items array, add a new first entry (before the existing `search` item) plus a separator:

```rust
            &MenuItem::with_id(handle, "home", "Home", true, Some("CmdOrCtrl+H"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "search", "Search", true, Some("CmdOrCtrl+K"))?,
```

(This replaces just the `&MenuItem::with_id(handle, "search", ...)` line at the top of the `view_menu` array — the two new lines go immediately before it.)

- [ ] **Step 2: Add the ShortcutsOverlay row**

In `src/components/ShortcutsOverlay.tsx`, add a new entry to the `SHORTCUTS` array, after the `Ctrl P` row:

```ts
  { keys: 'Ctrl P', label: 'Jump to a note by title' },
  { keys: 'Ctrl H', label: 'Home' },
```

- [ ] **Step 3: Wire `HomeView` into `Layout.tsx`**

Add the import near the other component imports (alongside `TaskView`):

```tsx
import { HomeView } from './HomeView'
```

Add a `setActiveTab` selector next to the existing `activeTab` one (`Layout.tsx:41`):

```tsx
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
```

Add a `home` case to the `runCommand` switch, after the `quick-switch` case:

```tsx
        case 'quick-switch':
          setSwitcherOpen(true)
          break
        case 'home':
          if (workspacePath) setActiveTab(null)
          break
```

Add `setActiveTab` to `runCommand`'s dependency array (alongside the other values it closes over):

```tsx
    [
      activeTab,
      viewMode,
      workspacePath,
      setActiveTab,
      createNote,
      createFolder,
      createCanvasNote,
      scaffoldProjectNotes,
      openWorkspace,
    ],
```

Replace the "notes exist" empty-state paragraph (the current `!activeTab && workspacePath && notes.length > 0` branch) with `HomeView`. The zero-notes branch (`notes.length === 0`) stays exactly as-is — P2-4's first-run "create your first note" hint is a better experience for a brand-new workspace than a dashboard with five empty sections:

```tsx
            {!activeTab && workspacePath && notes.length === 0 && (
              <p className="empty-state">
                Press Ctrl N to create your first note, or press ? for shortcuts
              </p>
            )}
            {!activeTab && workspacePath && notes.length > 0 && (
              <HomeView onOpenTaskView={() => setTaskViewOpen(true)} />
            )}
```

- [ ] **Step 4: Add CSS**

Add to `src/index.css`, after the `.task-view*` rules:

```css
/* Workspace dashboard (P9-4) — an inline main-pane view, not a modal
   overlay, since it replaces the empty-state slot rather than sitting
   on top of a note. */
.home-view {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-lg);
  padding: var(--space-xl) 0;
}

.home-section {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: var(--space-lg);
}

.home-section-disabled { opacity: 0.55; }

.home-section h2 {
  margin: 0 0 var(--space-md);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.home-section ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.home-section-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  padding: 3px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.home-section-item:hover { text-decoration: underline; }

.home-empty, .home-status {
  color: var(--text-tertiary);
  font-size: 13px;
  margin: 0;
}

.home-count {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0 0 var(--space-sm);
}

.home-view-all {
  margin-top: var(--space-sm);
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.home-view-all:hover { color: var(--text-primary); }
```

- [ ] **Step 5: Typecheck and run the full unit suite**

Run: `npm run typecheck && npm test`
Expected: no errors, all tests pass (existing suite plus Task 1/2's new tests).

- [ ] **Step 6: Build and manually verify**

Run: `npm run tauri dev`

- Open a workspace with a couple of notes and at least one open task; close all tabs (or a fresh workspace has none open) — confirm Home renders with Continue/Recent/Tasks/Study/Git.
- Open a note, then press `Ctrl+H` — confirm the main pane switches to Home and the note's tab is still present (not closed) in the tab bar.
- Click a Continue item, a Recent item, and a Task item — confirm each opens the right note and leaves Home.
- Click "View all" under Tasks — confirm the existing `TaskView` modal opens.

- [ ] **Step 7: Commit**

```bash
git add src/components/Layout.tsx src/components/ShortcutsOverlay.tsx src/index.css src-tauri/src/lib.rs
git commit -m "feat(p9-4): wire HomeView into Layout with an explicit Home command"
```

---

### Task 4: E2E coverage and full verification

**Files:**
- Create: `e2e/specs/home-dashboard.e2e.ts`

**Interfaces:**
- Consumes: `window.__e2eRunCommand('home')` (`Layout.tsx:218-220`, unchanged by this plan — already dispatches any `runCommand` id, including the new `home` case from Task 3), `fixtureWorkspace` (`e2e/fixtureWorkspace.ts`), `screenshot` (`e2e/screenshot.ts`).

The shared fixture workspace's `.workspace.json` state (which tabs were open at last close) isn't something a single e2e run controls reliably — `wdio.conf.ts` launches one app instance for the whole suite (`maxInstances: 1`), so this spec verifies the explicit `Ctrl+H` path rather than depending on a specific "no tab restored" launch state, which is already covered at the unit level by Task 2/3 (`HomeView` rendering behavior and the `!activeTab` branch in `Layout.tsx`).

- [ ] **Step 1: Write the e2e spec**

Create `e2e/specs/home-dashboard.e2e.ts`. It creates its note through the app's own "New Note" flow (same prompt-handling pattern as `create-note.e2e.ts`) rather than writing the file directly and waiting on the sidebar to notice — `useCreateNote` (`src/hooks/useCreateNote.ts:19-37`) both adds the note to the store and opens/activates its tab in one step, which sidesteps needing a real DOM selector for an arbitrary sidebar tree row:

```ts
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) {
      throw new Error(`clickInPage: no element matching ${sel}`)
    }
    el.click()
  }, selector)
}

function runCommand(id: string): Promise<void> {
  return browser.execute((cmdId) => {
    const w = window as unknown as { __e2eRunCommand?: (id: string) => void }
    w.__e2eRunCommand?.(cmdId)
  }, id)
}

describe('workspace dashboard', () => {
  it('the home command clears the active tab without closing it, and shows Home', async () => {
    const notePath = join(fixtureWorkspace, 'Home Dashboard Note.md')
    rmSync(notePath, { force: true })

    await clickInPage('.sidebar-new-actions button')
    await browser.waitUntil(
      async () => {
        try {
          await browser.getAlertText()
          return true
        } catch {
          return false
        }
      },
      { timeout: 5000, timeoutMsg: 'the note-title prompt() never appeared' },
    )
    await browser.sendAlertText('Home Dashboard Note')
    await browser.acceptAlert()

    await browser.waitUntil(() => existsSync(notePath), {
      timeout: 5000,
      timeoutMsg: 'note file was never created on disk',
    })
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelectorAll('.tab.active').length)) === 1,
      { timeout: 5000, timeoutMsg: 'the new note never became the active tab' },
    )

    await runCommand('home')

    await browser.waitUntil(
      async () => (await browser.execute(() => !!document.querySelector('.home-view'))) === true,
      { timeout: 5000, timeoutMsg: 'Home view never appeared after the home command' },
    )
    const tabCount = await browser.execute(() => document.querySelectorAll('.tab').length)
    const activeTabCount = await browser.execute(() => document.querySelectorAll('.tab.active').length)
    expect(tabCount).toBeGreaterThan(0)
    expect(activeTabCount).toBe(0)

    await screenshot('p9-4-home-dashboard')

    await clickInPage('.home-section-item')

    await browser.waitUntil(
      async () => (await browser.execute(() => !document.querySelector('.home-view'))) === true,
      { timeout: 5000, timeoutMsg: 'clicking a Home item never left the Home view' },
    )
  })
})
```

- [ ] **Step 2: Rebuild the debug app**

Run: `npm run tauri build -- --debug`
Expected: build succeeds (this is what `pretest:e2e` runs automatically, but running it explicitly first surfaces build errors before the slower WebDriver launch).

- [ ] **Step 3: Run the new spec**

Run: `npm run test:e2e -- --spec e2e/specs/home-dashboard.e2e.ts`
Expected: PASS.

- [ ] **Step 4: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: PASS (confirms nothing about the `!activeTab` branch change broke `create-note.e2e.ts` or any other existing spec).

- [ ] **Step 5: Visual check**

Run: `start e2e\.artifacts` (PowerShell/cmd) and open `p9-4-home-dashboard.png` — confirm all five sections render without overlap or clipping in both the light and dark theme if the app supports switching; report what you see to the user rather than assuming the screenshot looks right.

- [ ] **Step 6: Final full verification pass**

Run:

```bash
npm run typecheck
npm test
cargo clippy -- -D warnings
cargo fmt --check
```

(run the last two from `src-tauri/`). Expected: all clean. `cargo fmt --check` failing on unrelated pre-existing formatting is not this task's problem to fix — but the new code in `lib.rs` from Task 3 must not be the cause of any reported diff.

- [ ] **Step 7: Update the roadmap and TODO**

In `docs/ROADMAP.md`, change the `### P9-4 — Workspace dashboard — **M**` heading to append `✅`, and add a short "Done." paragraph (matching the style of the other completed P9 entries) noting: reuses the existing `!activeTab` branch rather than a new overlay, the explicit `Ctrl+H` command only clears `activeTab` (never closes a tab), and Study ships as a disabled placeholder pending P9-3.

In `TODO.md`, add a `### P9-4 Workspace dashboard — **M** ✅` entry under the `## ▸ P9` section mirroring P9-1/P9-2's checklist style, checking off each DoD bullet from the spec.

- [ ] **Step 8: Commit**

```bash
git add e2e/specs/home-dashboard.e2e.ts docs/ROADMAP.md TODO.md
git commit -m "test(p9-4): add home dashboard e2e coverage; mark P9-4 done"
```
