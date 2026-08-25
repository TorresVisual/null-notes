# Toast Acknowledgment Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Give the app a way to say "that worked" — a toast primitive wired to PDF import and template creation (the two user-initiated actions with no acknowledgment today) — plus a minimal loading indicator for workspace-open and note-open, which currently show nothing or plain text while real work happens.

**Architecture:** `src/store/toast.ts` mirrors `store/promptDialog.ts`'s established shape exactly: a plain function (`showToast`) that any call site imports and calls, backed by a Zustand store nobody else needs to know exists. `src/components/ToastStack.tsx` is a new, always-mounted component (same pattern as `<PromptDialog />`) rendering whatever the store holds. Loading state for workspace-open is a new `folderLoading` boolean on `useWorkspaceStore`, set around the existing `openWorkspaceAt` call in `useWorkspace.ts`; loading state for note-open reuses the existing `isLoading` flag `useNote` already returns, just adds a spinner next to the text already rendered for it.

**Tech Stack:** React 19 + TypeScript (strict), Zustand, Vitest + React Testing Library (fake timers for auto-dismiss).

**Spec:** `docs/specs/product-completion-pass-design.md` (§ WS2 — Acknowledgment layer)

## Global Constraints

- Toast call sites are exactly two: PDF import success (`ImportButton.tsx`), template-note creation success (`TemplateDialog.tsx`). Git auto-commit is explicitly **not** wired to a toast — see the spec's WS2 rationale (it already has a passive chip, and it's a background action, not a user-clicked one).
- `.toast` joins the existing shared `surface-in` animation selector list (`index.css:147-151`) rather than defining a second entrance animation.
- The workspace-loading label follows `ImportButton.tsx`'s already-established `{busy ? 'Importing…' : 'Import PDF'}` convention — `"Opening…"` while loading, not a new phrasing pattern.
- This task assumes `docs/plans/overlay-exclusivity.md` has already landed — Task 7 below extends the `Layout.test.tsx` mock harness that plan creates, rather than duplicating it.

---

### Task 1: Toast store

**Files:**
- Create: `src/store/toast.ts`
- Test: `src/store/toast.test.ts`

**Interfaces:**
- Produces: `showToast(message: string): void`, `useToastStore` (Zustand store with `toasts: { id: number; message: string }[]` and `dismiss: (id: number) => void`) — both consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `src/store/toast.test.ts`:

```ts
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { useToastStore, showToast, TOAST_AUTO_DISMISS_MS } from './toast'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  useToastStore.setState({ toasts: [] })
  vi.useRealTimers()
})

describe('toast store', () => {
  it('pushes a toast with the given message', () => {
    showToast('Imported "Lecture 7"')

    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe('Imported "Lecture 7"')
  })

  it('assigns each toast a distinct id', () => {
    showToast('First')
    showToast('Second')

    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(2)
    expect(toasts[0]!.id).not.toBe(toasts[1]!.id)
  })

  it('dismiss removes only the matching toast', () => {
    showToast('First')
    showToast('Second')
    const [first, second] = useToastStore.getState().toasts

    useToastStore.getState().dismiss(first!.id)

    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.id).toBe(second!.id)
  })

  it('auto-dismisses after TOAST_AUTO_DISMISS_MS', () => {
    showToast('Fades on its own')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS)

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  // A second toast pushed before the first expires must not reset the
  // first's timer — each toast's dismissal is scheduled once, at push time,
  // not recomputed from the current list on every change.
  it('an earlier toast still expires on its own schedule when a later one is pushed', () => {
    showToast('First')
    vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS / 2)
    showToast('Second')

    vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS / 2)

    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe('Second')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/store/toast.test.ts`
Expected: FAIL — `Cannot find module './toast'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/toast.ts`:

```ts
import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (message: string) => void
  dismiss: (id: number) => void
}

// Long enough to read a short confirmation, short enough to stay out of the
// way of the next one — same order of magnitude as the Git commit chip's
// own COMMITTED_DISPLAY_MS (useGitAutoCommit.ts).
export const TOAST_AUTO_DISMISS_MS = 4000

let nextId = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message }] }))
    // Scheduled once, here, at push time — not recomputed in a component
    // effect keyed on the toast list, which would reset every existing
    // toast's remaining time whenever a new one arrives.
    setTimeout(() => get().dismiss(id), TOAST_AUTO_DISMISS_MS)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Fire-and-forget acknowledgment, callable from anywhere — same shape as
// promptText (store/promptDialog.ts): a plain function wrapping the store
// so call sites don't need to know it's backed by Zustand.
export function showToast(message: string): void {
  useToastStore.getState().push(message)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/store/toast.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
git add src/store/toast.ts src/store/toast.test.ts
git commit -m "feat: add toast store for ephemeral acknowledgments"
```

---

### Task 2: `ToastStack` component, mounted in `Layout`

**Files:**
- Create: `src/components/ToastStack.tsx`
- Modify: `src/components/Layout.tsx` (import + mount)
- Modify: `src/index.css` (after line 151 — the `surface-in` shared-selector rule)
- Test: `src/components/ToastStack.test.tsx`

**Interfaces:**
- Consumes: `useToastStore`, `Toast` from Task 1.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ToastStack.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ToastStack } from './ToastStack'
import { useToastStore, showToast } from '../store/toast'

afterEach(() => {
  cleanup()
  useToastStore.setState({ toasts: [] })
})

describe('ToastStack', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastStack />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a pushed toast', () => {
    render(<ToastStack />)
    showToast('Imported "Lecture 7"')

    expect(screen.getByText('Imported "Lecture 7"')).toBeInTheDocument()
  })

  it('renders multiple toasts in push order', () => {
    render(<ToastStack />)
    showToast('First')
    showToast('Second')

    const items = screen.getAllByRole('status')
    expect(items.map((el) => el.textContent)).toEqual(['First', 'Second'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/ToastStack.test.tsx`
Expected: FAIL — `Cannot find module './ToastStack'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/ToastStack.tsx`:

```tsx
import { useToastStore } from '../store/toast'

export function ToastStack() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status">
          {t.message}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/ToastStack.test.tsx`
Expected: PASS, all three cases.

- [ ] **Step 5: Mount it in `Layout.tsx`**

Add the import alongside the other component imports:

```ts
import { ToastStack } from './ToastStack'
```

Add `<ToastStack />` immediately after `<PromptDialog />` in the overlay JSX block — same "always mounted, self-manages its own visibility" pattern:

```tsx
      <PromptDialog />
      <ToastStack />
```

- [ ] **Step 6: Add the CSS**

In `src/index.css`, insert after line 151 (the closing brace of the `surface-in` shared-selector rule):

```css
.toast-stack {
  position: fixed;
  bottom: var(--space-lg);
  right: var(--space-lg);
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  pointer-events: none;
}

.toast {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: var(--shadow-popover);
  padding: var(--space-sm) var(--space-md);
  font-size: 13px;
  color: var(--text-primary);
}
```

Add `.toast` to the existing shared `surface-in` selector list (the rule now at what was line 148, shifted down by the new block above — search for the `.context-menu, .slash-menu, ...` selector rather than relying on the line number, since Step 6 shifted it):

```css
.context-menu, .slash-menu, .math-editor, .math-snippet-menu, .block-handle-menu,
.search-modal, .settings-panel, .import-mode-dialog, .graph-view, .task-view,
.review-session, .formula-sheet-prompt, .toast {
  animation: surface-in var(--duration-base) var(--ease-spring);
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/components/ToastStack.tsx src/components/ToastStack.test.tsx src/components/Layout.tsx src/index.css
git commit -m "feat: mount ToastStack in Layout"
```

---

### Task 3: Wire `showToast` to PDF import success

**Files:**
- Modify: `src/components/ImportButton.tsx:112-118`
- Test: `src/components/ImportButton.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/components/ImportButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportButton } from './ImportButton'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'

vi.mock('../lib/tauri', () => ({
  api: {
    pdf: {
      hasTextLayer: vi.fn(),
      importMarkdown: vi.fn(),
      importPages: vi.fn(),
    },
    notes: {
      create: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      reindex: vi.fn().mockResolvedValue(undefined),
    },
    assets: { write: vi.fn() },
  },
}))
vi.mock('../pdf/usePdfImport', () => ({
  usePdfImport: () => ({
    pickPdf: vi.fn().mockResolvedValue({ path: '/tmp/Lecture 7.pdf', title: 'Lecture 7' }),
    importPages: vi.fn(),
    isImporting: false,
    progress: null,
  }),
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws', selectedFolder: null })
  useNotesStore.setState({ notes: [], folders: [], tags: [] })
  vi.mocked(api.pdf.hasTextLayer).mockResolvedValue(true)
  vi.mocked(api.pdf.importMarkdown).mockResolvedValue({ markdown: 'Body text', images: [] })
  vi.mocked(api.notes.create).mockResolvedValue({
    id: '1',
    path: '/ws/Lecture 7.md',
    title: 'Lecture 7',
    workspace: '/ws',
    updatedAt: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ImportButton', () => {
  it('shows a toast naming the note once a Markdown import succeeds', async () => {
    const user = userEvent.setup()
    render(<ImportButton />)

    await user.click(screen.getByRole('button', { name: /Import PDF/ }))
    await user.click(await screen.findByRole('button', { name: /As Markdown/ }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Imported "Lecture 7"'))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/ImportButton.test.tsx`
Expected: FAIL — `showToast` never called.

- [ ] **Step 3: Wire the call site**

In `src/components/ImportButton.tsx`, add the import:

```ts
import { showToast } from '../store/toast'
```

In `runImport`, after `expandFolder(folder)` (the last line of the try block, `ImportButton.tsx:118`), add:

```ts
      expandFolder(folder)
      showToast(`Imported "${picked.title}"`)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/ImportButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ImportButton.tsx src/components/ImportButton.test.tsx
git commit -m "feat: acknowledge successful PDF import with a toast"
```

---

### Task 4: Wire `showToast` to template-note creation

**Files:**
- Modify: `src/components/TemplateDialog.tsx:58-68`
- Test: `src/components/TemplateDialog.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/components/TemplateDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateDialog } from './TemplateDialog'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'

vi.mock('../lib/tauri', () => ({
  api: {
    templates: {
      list: vi.fn(),
      read: vi.fn(),
      createNote: vi.fn(),
    },
  },
}))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws', selectedFolder: null })
  vi.mocked(api.templates.list).mockResolvedValue([{ path: '/ws/templates/exercise.md', name: 'Exercise sheet' }])
  vi.mocked(api.templates.read).mockResolvedValue('# {{title}}\n')
  vi.mocked(api.templates.createNote).mockResolvedValue({
    id: '1',
    path: '/ws/Sheet 3.md',
    title: 'Sheet 3',
    workspace: '/ws',
    updatedAt: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TemplateDialog', () => {
  it('shows a toast naming the note once creation succeeds', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TemplateDialog onClose={onClose} />)

    await user.click(await screen.findByText('Exercise sheet'))
    await user.type(screen.getByLabelText(/Note title/), 'Sheet 3')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Created "Sheet 3"'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/TemplateDialog.test.tsx`
Expected: FAIL — `showToast` never called.

- [ ] **Step 3: Wire the call site**

In `src/components/TemplateDialog.tsx`, add the import:

```ts
import { showToast } from '../store/toast'
```

Change `handleCreate` (lines 58-68) from:

```ts
    const meta = await createNoteFromTemplate(title, content)
    if (meta) onClose()
```

to:

```ts
    const meta = await createNoteFromTemplate(title, content)
    if (meta) {
      showToast(`Created "${meta.title}"`)
      onClose()
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/TemplateDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TemplateDialog.tsx src/components/TemplateDialog.test.tsx
git commit -m "feat: acknowledge successful template note creation with a toast"
```

---

### Task 5: `folderLoading` on the workspace store

**Files:**
- Modify: `src/store/workspace.ts:43-44` (interface), `src/store/workspace.ts:92` (initial state), `src/store/workspace.ts:166` (setter, next to `setFolderError`)
- Modify: `src/hooks/useWorkspace.ts:40-85` (`openWorkspaceAt`)
- Test: `src/store/workspace.test.ts` (extend), `src/hooks/useWorkspace.test.ts` (extend, or create if it doesn't already exist — check first with `Glob src/hooks/useWorkspace.test.ts`)

**Interfaces:**
- Produces: `useWorkspaceStore.getState().folderLoading: boolean`, `setFolderLoading: (loading: boolean) => void` — consumed by Task 6.

- [ ] **Step 1: Write the failing store test**

Add to `src/store/workspace.test.ts` (create the file with this one case if it doesn't already exist; if it does, add alongside the existing `folderError`-adjacent cases):

```ts
  it('setFolderLoading toggles the loading flag independently of folderError', () => {
    useWorkspaceStore.getState().setFolderLoading(true)
    expect(useWorkspaceStore.getState().folderLoading).toBe(true)
    expect(useWorkspaceStore.getState().folderError).toBeNull()

    useWorkspaceStore.getState().setFolderLoading(false)
    expect(useWorkspaceStore.getState().folderLoading).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/store/workspace.test.ts`
Expected: FAIL — TypeScript error, `setFolderLoading` does not exist on the store.

- [ ] **Step 3: Add the field and setter**

In `src/store/workspace.ts`, add to the interface right after `setFolderError` (line 44):

```ts
  folderLoading: boolean
  setFolderLoading: (loading: boolean) => void
```

Add to the initial state right after `folderError: null,` (line 92):

```ts
  folderLoading: false,
```

Add the implementation right after `setFolderError: (message) => set({ folderError: message }),` (line 166):

```ts
  setFolderLoading: (loading) => set({ folderLoading: loading }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/store/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing hook test**

Check first whether `src/hooks/useWorkspace.test.ts` already exists (`Glob src/hooks/useWorkspace.test.ts`). If it does, add this case among the existing `openWorkspaceAt` tests, reusing whatever `api` mock that file already sets up. If it doesn't, create it:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWorkspace } from './useWorkspace'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { scan: vi.fn() },
    workspace: { load: vi.fn(), watch: vi.fn().mockResolvedValue(undefined), save: vi.fn(), remember: vi.fn() },
    git: { detectRepo: vi.fn() },
  },
}))

beforeEach(() => {
  useWorkspaceStore.setState({
    path: null,
    openTabs: [],
    activeTab: null,
    expandedFolders: [],
    folderLoading: false,
    folderError: null,
    git: { prompted: false, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
  })
  useNotesStore.setState({ notes: [], folders: [], tags: [] })
  vi.mocked(api.notes.scan).mockResolvedValue({ notes: [], folders: [] })
  vi.mocked(api.workspace.load).mockResolvedValue({
    openTabs: [],
    activeTab: null,
    expandedFolders: [],
    recentSearches: [],
    git: { prompted: false, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
  })
  vi.mocked(api.workspace.remember).mockResolvedValue([])
  vi.mocked(api.git.detectRepo).mockResolvedValue(null)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useWorkspace openWorkspaceAt loading state', () => {
  it('sets folderLoading true while scanning, false once settled', async () => {
    const { result } = renderHook(() => useWorkspace())

    const promise = result.current.openWorkspaceAt('/ws')
    expect(useWorkspaceStore.getState().folderLoading).toBe(true)

    await promise
    expect(useWorkspaceStore.getState().folderLoading).toBe(false)
  })

  it('clears folderLoading even when the scan fails', async () => {
    vi.mocked(api.notes.scan).mockRejectedValue(new Error('not found'))
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(useWorkspaceStore.getState().folderLoading).toBe(false)
    expect(useWorkspaceStore.getState().folderError).toBe('not found')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- src/hooks/useWorkspace.test.ts`
Expected: FAIL — `folderLoading` stays `false` (or `undefined`) immediately after calling `openWorkspaceAt`, since nothing sets it yet.

- [ ] **Step 7: Wire the flag into `openWorkspaceAt`**

In `src/hooks/useWorkspace.ts`, change the destructure and add the two set points:

```ts
      const { setFolderError, setFolderLoading, setRecentWorkspaces, setRecentSearches, setGit, setRepoMode } =
        useWorkspaceStore.getState()
      setFolderLoading(true)
      let tree, session
      try {
        ;[tree, session] = await Promise.all([
          api.notes.scan(selected),
          api.workspace.load(selected),
        ])
      } catch (e) {
        setFolderError(e instanceof Error ? e.message : String(e))
        setFolderLoading(false)
        return
      }
```

And at the very end of `openWorkspaceAt`, right after the `try`/`catch` around `detectRepo` (the function's last statement):

```ts
      try {
        const mode = await api.git.detectRepo(selected)
        setRepoMode(mode)
        if (mode) await checkForUpdates(selected)
      } catch {
        setRepoMode(null)
      }
      setFolderLoading(false)
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- src/hooks/useWorkspace.test.ts src/store/workspace.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/store/workspace.ts src/store/workspace.test.ts src/hooks/useWorkspace.ts src/hooks/useWorkspace.test.ts
git commit -m "feat: track folderLoading while a workspace is opening"
```

---

### Task 6: Show the loading state in `WorkspacePicker` and `Sidebar`

**Files:**
- Modify: `src/components/WorkspacePicker.tsx`
- Modify: `src/components/Sidebar.tsx:72-74`
- Test: `src/components/WorkspacePicker.test.tsx` (new), `src/components/Sidebar.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

Create `src/components/WorkspacePicker.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WorkspacePicker } from './WorkspacePicker'
import { useWorkspaceStore } from '../store/workspace'

afterEach(() => {
  cleanup()
})

describe('WorkspacePicker loading state', () => {
  it('disables the browse button and shows "Opening…" while a workspace is loading', () => {
    useWorkspaceStore.setState({ recentWorkspaces: [], folderLoading: true })
    render(<WorkspacePicker />)

    const button = screen.getByRole('button', { name: /Opening…/ })
    expect(button).toBeDisabled()
  })

  it('shows the normal label and an enabled button when not loading', () => {
    useWorkspaceStore.setState({ recentWorkspaces: [], folderLoading: false })
    render(<WorkspacePicker />)

    const button = screen.getByRole('button', { name: /Choose a folder…/ })
    expect(button).toBeEnabled()
  })
})
```

Add to `src/components/Sidebar.test.tsx`, in a new `describe`:

```ts
describe('Sidebar Open Workspace button', () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [], folders: [], tags: [] })
  })

  it('shows "Opening…" and disables itself while folderLoading is true', () => {
    useWorkspaceStore.setState({ path: null, activeTab: null, tagFilter: null, folderLoading: true })
    render(<Sidebar {...props} />)

    expect(screen.getByRole('button', { name: /Opening…/ })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/WorkspacePicker.test.tsx src/components/Sidebar.test.tsx`
Expected: FAIL — no "Opening…" label exists yet in either component.

- [ ] **Step 3: Update `WorkspacePicker.tsx`**

```tsx
export function WorkspacePicker() {
  const recents = useWorkspaceStore((s) => s.recentWorkspaces)
  const folderLoading = useWorkspaceStore((s) => s.folderLoading)
  const { openWorkspace, openWorkspaceAt } = useWorkspace()

  return (
    <div className="workspace-picker">
      <img src="/favicon.svg" alt="" width={56} height={56} className="workspace-picker-mark" />
      <h1 className="workspace-picker-title">null-notes</h1>
      <p className="workspace-picker-subtitle">
        Open a folder of Markdown notes to get started.
      </p>

      {recents.length > 0 && (
        <>
          <h2 className="workspace-picker-heading">
            <History size={13} /> Recent
          </h2>
          <ul className="workspace-picker-recents">
            {recents.map((path) => (
              <li key={path}>
                <button onClick={() => void openWorkspaceAt(path)} title={path} disabled={folderLoading}>
                  <span className="workspace-picker-name">{folderName(path)}</span>
                  <span className="workspace-picker-path">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="workspace-picker-browse" onClick={() => void openWorkspace()} disabled={folderLoading}>
        <FolderOpen size={14} /> {folderLoading ? 'Opening…' : 'Choose a folder…'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Update `Sidebar.tsx`**

Add the selector near the other `useWorkspaceStore` selectors:

```ts
  const folderLoading = useWorkspaceStore((s) => s.folderLoading)
```

Change the "Open Workspace" button (lines 72-74):

```tsx
      <button className="sidebar-workspace-btn" onClick={() => void openWorkspace()} disabled={folderLoading}>
        <FolderOpen size={14} /> {folderLoading ? 'Opening…' : 'Open Workspace'}
      </button>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/components/WorkspacePicker.test.tsx src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npm test -- --run`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/WorkspacePicker.tsx src/components/WorkspacePicker.test.tsx src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat: show a loading affordance while a workspace is opening"
```

---

### Task 7: Spinner on the note-loading state

**Files:**
- Modify: `src/components/Layout.tsx:358`
- Modify: `src/index.css`
- Modify: `src/components/Layout.test.tsx` (extend — reuses the mock harness `docs/plans/overlay-exclusivity.md` created)

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `src/components/Layout.test.tsx`, reusing the file's existing mocks and `beforeEach`/`afterEach`. This case overrides the `useNote` mock's `isLoading` for one test only, via `vi.mocked`:

```tsx
import { useNote } from '../hooks/useNote'
// (add alongside the file's existing imports)

describe('Layout note-loading indicator', () => {
  it('shows a spinner next to the loading text while a note is loading', () => {
    useWorkspaceStore.setState({ path: '/ws', activeTab: '/ws/Lecture.md', tagFilter: null })
    useNotesStore.setState({
      notes: [{ id: '1', path: '/ws/Lecture.md', title: 'Lecture', workspace: '/ws', updatedAt: 0 }],
      folders: [],
      tags: [],
    })
    vi.mocked(useNote).mockReturnValue({
      content: '',
      save: vi.fn(),
      isLoading: true,
      saveState: 'clean',
      saveError: null,
      flush: vi.fn().mockResolvedValue(undefined),
      retrySave: vi.fn(),
      dismissError: vi.fn(),
      conflict: false,
      keepMine: vi.fn(),
      reloadTheirs: vi.fn(),
    })

    render(<Layout />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(document.querySelector('.spin')).toBeInTheDocument()
  })
})
```

This requires the file's `vi.mock('../hooks/useNote', ...)` factory (added in `docs/plans/overlay-exclusivity.md`'s Task 2) to become overridable per-test — change it from returning a fixed object to wrapping `vi.fn()`:

```ts
vi.mock('../hooks/useNote', () => ({
  useNote: vi.fn(() => ({
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
  })),
}))
```

(The existing overlay-exclusivity tests keep passing unchanged — they never call `vi.mocked(useNote).mockReturnValue(...)`, so they still get this same default object.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/Layout.test.tsx`
Expected: FAIL — no element matches `.spin`.

- [ ] **Step 3: Add the spinner**

In `src/components/Layout.tsx`, add `Loader2` to the existing `lucide-react` import — there isn't one yet in this file, so add a new import line near the top:

```ts
import { Loader2 } from 'lucide-react'
```

Change line 358:

```tsx
              {isLoading && (
                <p className="status">
                  <Loader2 size={14} className="spin" /> Loading…
                </p>
              )}
```

- [ ] **Step 4: Add the CSS**

In `src/index.css`, add near the `.status` rule (line 429, shared with `.empty-state`):

```css
.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

(Reduced-motion is covered automatically by the existing blanket `*` rule at `index.css:133-135` — no extra guard needed.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/components/Layout.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npm test -- --run`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/Layout.tsx src/components/Layout.test.tsx src/index.css
git commit -m "feat: spin an icon next to the note-loading indicator"
```
