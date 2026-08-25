# Overlay Exclusivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Fix a live bug — Settings never closes on Escape, and pressing `?` right after stacks the Shortcuts overlay on top of it — by replacing nine independent overlay booleans in `Layout.tsx` with one exclusive `activeOverlay` value and a single universal Escape handler.

**Architecture:** A new hook, `useOverlayManager` (`src/hooks/useOverlayManager.ts`), owns one `activeOverlay: OverlayKind | null` value plus `openOverlay`/`closeOverlay`. Opening any overlay replaces whichever was active — exclusivity by construction. One `window` `keydown` listener inside the hook closes the active overlay on Escape, replacing each overlay's own ad hoc handling. `Layout.tsx` is rewired to consume this hook instead of its nine `useState<boolean>` flags; `SearchModal` and `QuickSwitcher` lose their now-redundant local Escape branches.

**Tech Stack:** React 19 + TypeScript (strict), Vitest + React Testing Library (`renderHook`, `render`, `act`).

**Spec:** `docs/specs/product-completion-pass-design.md` (§ WS1 — Overlay exclusivity)

## Global Constraints

- `OverlayKind` covers exactly the nine `.search-overlay`-backdrop modals: `'search' | 'switcher' | 'settings' | 'shortcuts' | 'template' | 'graph' | 'task' | 'review' | 'formulaSheet'` — from the spec's WS1 section.
- `PromptDialog`, `TerminalPane`, `OutlinePanel`, `ConflictBar`, `GitDivergedBar`, `GitAutoCommitPrompt` are explicitly out of scope (spec's WS1 "Explicitly out of scope" list) — do not fold them into `OverlayKind`.
- No behavior change to which commands open which overlay, or to any overlay's own content — only how "which one is open" is tracked and how Escape is handled.
- **This plan runs after `docs/plans/remove-scaffold-notes.md`.** By the time Task 2 below writes `Layout.tsx`'s mock harness, `useScaffoldProjectNotes` no longer exists — the harness does not mock it, and `runCommand`'s switch has no `'scaffold-notes'` case to worry about.

---

### Task 1: `useOverlayManager` hook

**Files:**
- Create: `src/hooks/useOverlayManager.ts`
- Test: `src/hooks/useOverlayManager.test.ts`

**Interfaces:**
- Produces: `useOverlayManager(): { activeOverlay: OverlayKind | null; openOverlay: (kind: OverlayKind) => void; closeOverlay: () => void }` and the exported type `OverlayKind` — both consumed directly by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useOverlayManager.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useOverlayManager } from './useOverlayManager'

afterEach(() => {
  cleanup()
})

describe('useOverlayManager', () => {
  it('starts with no overlay active', () => {
    const { result } = renderHook(() => useOverlayManager())
    expect(result.current.activeOverlay).toBeNull()
  })

  it('openOverlay sets the active overlay', () => {
    const { result } = renderHook(() => useOverlayManager())
    act(() => result.current.openOverlay('settings'))
    expect(result.current.activeOverlay).toBe('settings')
  })

  it('opening a second overlay replaces the first — one overlay at a time', () => {
    const { result } = renderHook(() => useOverlayManager())
    act(() => result.current.openOverlay('settings'))
    act(() => result.current.openOverlay('shortcuts'))
    expect(result.current.activeOverlay).toBe('shortcuts')
  })

  it('closeOverlay clears the active overlay', () => {
    const { result } = renderHook(() => useOverlayManager())
    act(() => result.current.openOverlay('search'))
    act(() => result.current.closeOverlay())
    expect(result.current.activeOverlay).toBeNull()
  })

  it('Escape closes whichever overlay is active', () => {
    const { result } = renderHook(() => useOverlayManager())
    act(() => result.current.openOverlay('settings'))

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(result.current.activeOverlay).toBeNull()
  })

  it('Escape with nothing open is a no-op', () => {
    const { result } = renderHook(() => useOverlayManager())

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(result.current.activeOverlay).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/hooks/useOverlayManager.test.ts`
Expected: FAIL — `Cannot find module './useOverlayManager'`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useOverlayManager.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'

export type OverlayKind =
  | 'search'
  | 'switcher'
  | 'settings'
  | 'shortcuts'
  | 'template'
  | 'graph'
  | 'task'
  | 'review'
  | 'formulaSheet'

/**
 * One overlay open at a time, by construction: opening a new one always
 * replaces whichever was active, and Escape always closes whichever is
 * active — a single mechanism standing in for what used to be nine
 * independent booleans in Layout.tsx with no shared rule between them.
 */
export function useOverlayManager() {
  const [activeOverlay, setActiveOverlay] = useState<OverlayKind | null>(null)

  const openOverlay = useCallback((kind: OverlayKind) => setActiveOverlay(kind), [])
  const closeOverlay = useCallback(() => setActiveOverlay(null), [])

  useEffect(() => {
    if (!activeOverlay) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeOverlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeOverlay, closeOverlay])

  return { activeOverlay, openOverlay, closeOverlay }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/hooks/useOverlayManager.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOverlayManager.ts src/hooks/useOverlayManager.test.ts
git commit -m "feat: add useOverlayManager for exclusive overlay state"
```

---

### Task 2: Wire `Layout.tsx` to `useOverlayManager`, remove dead Escape branches

**Files:**
- Modify: `src/components/Layout.tsx:78-88` (state), `src/components/Layout.tsx:139-212` (runCommand cases), `src/components/Layout.tsx:246-255` (bare `?` handler), `src/components/Layout.tsx:308-319` (overlay JSX)
- Modify: `src/components/SearchModal.tsx:56-69` (remove dead Escape branch)
- Modify: `src/components/QuickSwitcher.tsx:51-64` (remove dead Escape branch)
- Test: `src/components/Layout.test.tsx` (new)

**Interfaces:**
- Consumes: `useOverlayManager()` from Task 1 — `activeOverlay: OverlayKind | null`, `openOverlay(kind)`, `closeOverlay()`.

- [ ] **Step 1: Write the failing integration test**

Create `src/components/Layout.test.tsx`. This mounts the real `Layout` (and its real, un-mocked `Sidebar`/`TabBar`/`WorkspacePicker`/`PromptDialog`/`FolderContextMenu` children) with every Tauri-facing hook and IPC call mocked, then drives overlay commands through the same `window.__e2eRunCommand` seam the app's own e2e suite uses (`Layout.tsx:237-239`) — the real dispatcher a menu click or keyboard shortcut goes through, just reachable from a test:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { Layout } from './Layout'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settings'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  message: vi.fn(),
  open: vi.fn(),
}))
vi.mock('../lib/tauri', () => ({
  api: {
    workspace: { initialWorkspace: vi.fn().mockResolvedValue(null) },
    settings: { load: vi.fn().mockResolvedValue(DEFAULT_SETTINGS) },
    terminal: { close: vi.fn().mockResolvedValue(undefined) },
    window: { confirmClose: vi.fn().mockResolvedValue(undefined) },
    notes: {
      notesWithTag: vi.fn().mockResolvedValue([]),
      listOpenTasks: vi.fn().mockResolvedValue([]),
      listDueCards: vi.fn().mockResolvedValue([]),
    },
  },
}))
vi.mock('../hooks/useNote', () => ({
  useNote: () => ({
    content: '',
    save: vi.fn(),
    isLoading: false,
    saveState: 'clean',
    saveError: null,
    flush: vi.fn().mockResolvedValue(undefined),
    retrySave: vi.fn(),
    dismissError: vi.fn(),
    conflict: false,
    keepMine: vi.fn(),
    reloadTheirs: vi.fn(),
  }),
}))
vi.mock('../hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    saveSession: vi.fn().mockResolvedValue(undefined),
    openWorkspace: vi.fn(),
    openWorkspaceAt: vi.fn().mockResolvedValue(undefined),
  }),
  refreshTags: vi.fn().mockResolvedValue(undefined),
  refreshRecents: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../hooks/useExternalChanges', () => ({ useExternalChanges: () => {} }))
vi.mock('../hooks/useCreateNote', () => ({ useCreateNote: () => vi.fn() }))
vi.mock('../hooks/useCreateFolder', () => ({ useCreateFolder: () => vi.fn() }))
vi.mock('../hooks/useCreateCanvasNote', () => ({ useCreateCanvasNote: () => vi.fn() }))
vi.mock('../hooks/useScrollRestoration', () => ({ useScrollRestoration: () => ({ current: null }) }))
vi.mock('../hooks/useGitConfig', () => ({ useGitConfig: () => ({ updateGit: vi.fn() }) }))
vi.mock('../hooks/useGitAutoCommit', () => ({
  useGitAutoCommit: () => ({ flushGitCommit: vi.fn().mockResolvedValue(undefined) }),
}))

function runCommand(id: string) {
  ;(window as unknown as { __e2eRunCommand: (id: string) => void }).__e2eRunCommand(id)
}

function pressKey(key: string) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

beforeEach(() => {
  useWorkspaceStore.setState({ path: null, activeTab: null, tagFilter: null })
  useNotesStore.setState({ notes: [], folders: [], tags: [] })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Layout overlay exclusivity', () => {
  it('opening Settings then pressing ? replaces it with Shortcuts, not stacks on top', () => {
    render(<Layout />)

    act(() => runCommand('settings'))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    act(() => pressKey('?'))

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
  })

  it('Escape closes Settings', () => {
    render(<Layout />)

    act(() => runCommand('settings'))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    act(() => pressKey('Escape'))

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('Escape closes Search, without SearchModal handling it itself', () => {
    render(<Layout />)

    act(() => runCommand('search'))
    expect(screen.getByPlaceholderText(/Search notes/)).toBeInTheDocument()

    act(() => pressKey('Escape'))

    expect(screen.queryByPlaceholderText(/Search notes/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/Layout.test.tsx`
Expected: FAIL on the first case — pressing `?` after Settings currently leaves Settings' heading in the document alongside Shortcuts' (the actual live bug).

- [ ] **Step 3: Replace the nine overlay booleans with `useOverlayManager`**

In `src/components/Layout.tsx`, add the import near the other hook imports (after the `useScrollRestoration` import):

```ts
import { useOverlayManager, type OverlayKind } from '../hooks/useOverlayManager'
```

Replace lines 78-88 (`const [searchOpen, setSearchOpen] = useState(false)` through `const [formulaSheetOpen, setFormulaSheetOpen] = useState(false)`, keeping `outlineOpen`, `terminalMounted`, `terminalOpen` untouched since they're panels, not `OverlayKind` members) with:

```ts
  const { activeOverlay, openOverlay, closeOverlay } = useOverlayManager()
```

- [ ] **Step 4: Update `runCommand`'s overlay-opening cases**

In the same file's `runCommand` switch, replace each of these bodies (keeping every existing guard condition exactly as-is):

```ts
        case 'new-from-template':
          if (workspacePath) openOverlay('template')
          break
```
```ts
        case 'settings':
          openOverlay('settings')
          break
        case 'search':
          openOverlay('search')
          break
        case 'quick-switch':
          openOverlay('switcher')
          break
```
```ts
        case 'shortcuts-help':
          openOverlay('shortcuts')
          break
        case 'graph-view':
          if (workspacePath) openOverlay('graph')
          break
        case 'task-view':
          if (workspacePath) openOverlay('task')
          break
        case 'review':
          if (workspacePath) openOverlay('review')
          break
        case 'generate-formula-sheet':
          if (workspacePath) openOverlay('formulaSheet')
          break
```

Add `openOverlay` to `runCommand`'s `useCallback` dependency array (it replaces the now-removed `setTemplateDialogOpen` etc., which were stable `useState` setters and were never in the array either — `openOverlay` is stable from `useCallback` in Task 1's hook, so this is a like-for-like addition).

- [ ] **Step 5: Update the bare `?` handler and the overlay JSX**

Replace `setShortcutsOpen(true)` at line 251 with `openOverlay('shortcuts')`.

Replace the nine conditional overlay lines (lines 310-319) with:

```tsx
      {activeOverlay === 'search' && <SearchModal onClose={closeOverlay} />}
      {activeOverlay === 'switcher' && <QuickSwitcher onClose={closeOverlay} />}
      {activeOverlay === 'settings' && <SettingsPanel onClose={closeOverlay} />}
      {activeOverlay === 'shortcuts' && <ShortcutsOverlay onClose={closeOverlay} />}
      <PromptDialog />
      {activeOverlay === 'template' && <TemplateDialog onClose={closeOverlay} />}
      {activeOverlay === 'graph' && <GraphView onClose={closeOverlay} />}
      {activeOverlay === 'task' && <TaskView onClose={closeOverlay} />}
      {activeOverlay === 'review' && <ReviewSession onClose={closeOverlay} />}
      {activeOverlay === 'formulaSheet' && <FormulaSheetPrompt onClose={closeOverlay} />}
```

- [ ] **Step 6: Update the three inline overlay-opening callbacks**

`Sidebar`'s props (line ~321-323) and `HomeView`'s props (line ~384-386) pass inline closures that called the old setters — update each to call `openOverlay` with the matching kind:

```tsx
      <Sidebar
        onSearchOpen={() => openOverlay('search')}
        onSettingsOpen={() => openOverlay('settings')}
        onTemplateOpen={() => openOverlay('template')}
      />
```

```tsx
              {!activeTab && workspacePath && notes.length > 0 && (
                <HomeView
                  onOpenTaskView={() => openOverlay('task')}
                  onOpenReview={() => openOverlay('review')}
                  onOpenSettings={() => openOverlay('settings')}
                />
              )}
```

- [ ] **Step 7: Remove the now-redundant Escape branches**

In `src/components/SearchModal.tsx`'s `handleKeyDown` (lines 56-69), delete the `if (e.key === 'Escape') { onClose() }` branch, changing the `if`/`else if` chain to start at `ArrowDown`:

```ts
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      const hit = results[selected]
      if (hit) open(hit.path)
    }
  }
```

Apply the identical change to `src/components/QuickSwitcher.tsx`'s `handleKeyDown` (lines 51-64).

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- src/components/Layout.test.tsx`
Expected: PASS, all three cases.

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `npm test -- --run`
Expected: PASS — no other test references the removed `xOpen`/`setXOpen` state names (they were local to `Layout.tsx`, never exported).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/Layout.tsx src/components/Layout.test.tsx src/components/SearchModal.tsx src/components/QuickSwitcher.tsx
git commit -m "fix: enforce one overlay at a time and universal Escape-to-close"
```
