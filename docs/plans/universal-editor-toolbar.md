# Universal Editor Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Replace the toolbar rendered inside every ink canvas with one sticky toolbar at the top of the editor pane, which also hosts text-formatting, insert and exercise-sheet controls.

**Architecture:** The half of the ink toolbar's state that is already global — tool, pens, active pen, eraser mode and size, all persisted in `localStorage` — moves into a new Zustand store, `src/store/ink.ts`. The half that is genuinely per-canvas — strokes, history, selection, ruler, zoom — stays in `useInkCanvas`, and the canvas the user is drawing in registers a `CanvasHandle` in the store so the bar's undo, redo, ruler, delete-selection and zoom buttons have a target. `EditorToolbar` renders one group at a time depending on context.

**Tech Stack:** React 19, TypeScript strict, Zustand, TipTap 3 / ProseMirror, Vitest + Testing Library.

**Spec:** `docs/specs/universal-editor-toolbar-design.md`

## Global Constraints

- Strict TypeScript. No `any`; no non-null assertion unless the null case is structurally impossible.
- Named exports everywhere. Components `PascalCase`, hooks `useCamelCase`, module constants `SCREAMING_SNAKE_CASE`.
- One component per file. Props typed inline with an `interface`.
- Shared state goes in a Zustand store under `src/store/`; local state stays `useState`.
- No comments unless the WHY is non-obvious.
- `npm run typecheck` and `npm test` must pass before every commit.
- `ink/pens.ts` is and remains the only module that touches `localStorage` for ink. The store calls its `load*`/`save*` helpers; it never reads or writes storage keys directly.
- The existing ink tests (`useInkCanvas.test.ts`, `pens.test.ts`, `hitTest`, `lasso`, `pointEraser`, `ruler`, `shapePreview`, `zoom`, `svgSerialiser`, `paintOrder`) are the regression baseline. **None of them should need to change.** If one does, the state split has moved something it should not have.

---

### Task 1: The ink store

**Files:**
- Create: `src/store/ink.ts`
- Test: `src/store/ink.test.ts`

**Interfaces:**
- Consumes: `Tool`, `EraserMode`, `Pen` from `src/ink/types`; `DEFAULT_PENS`, `withPen`, `clampEraserSize`, `loadPens`, `savePens`, `loadActivePenId`, `saveActivePenId`, `loadEraserMode`, `saveEraserMode`, `loadEraserSize`, `saveEraserSize` from `src/ink/pens`.
- Produces:
  - `useInkStore` — Zustand store with state `{ tool, pens, activePenId, eraserMode, eraserSize }` and actions `setTool(tool)`, `selectPen(id)`, `updateActivePen(changes)`, `setEraserMode(mode)`, `setEraserSize(size)`.
  - `activePenOf(state): Pen` — the selected pen, falling back to `DEFAULT_PENS[0]`.

- [ ] **Step 1: Write the failing test**

Create `src/store/ink.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useInkStore, activePenOf } from './ink'
import { DEFAULT_PENS } from '../ink/pens'

function reset() {
  localStorage.clear()
  useInkStore.setState({
    tool: 'pen',
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
  })
}

describe('the ink store', () => {
  beforeEach(reset)

  it('starts with the pen tool and the first preset', () => {
    const state = useInkStore.getState()
    expect(state.tool).toBe('pen')
    expect(activePenOf(state).id).toBe(DEFAULT_PENS[0].id)
  })

  it('changes the tool', () => {
    useInkStore.getState().setTool('eraser')
    expect(useInkStore.getState().tool).toBe('eraser')
  })

  // Picking a pen is also picking up the pen: you reach for a colour in order
  // to draw with it, never to erase with it.
  it('selecting a pen switches back to the pen tool', () => {
    useInkStore.getState().setTool('eraser')
    useInkStore.getState().selectPen(DEFAULT_PENS[1].id)

    expect(useInkStore.getState().activePenId).toBe(DEFAULT_PENS[1].id)
    expect(useInkStore.getState().tool).toBe('pen')
  })

  it('persists the selected pen', () => {
    useInkStore.getState().selectPen(DEFAULT_PENS[1].id)
    expect(localStorage.getItem('null-notes.ink.activePen')).toBe(DEFAULT_PENS[1].id)
  })

  // Colour and size are not separate state: the selected preset *is* the pen,
  // and editing either edits that preset in place, which is what makes a pen
  // you configured still be there in tomorrow's lecture.
  it('editing colour edits the active pen and persists it', () => {
    useInkStore.getState().updateActivePen({ color: '#ff0000' })

    expect(activePenOf(useInkStore.getState()).color).toBe('#ff0000')
    expect(localStorage.getItem('null-notes.ink.pens')).toContain('#ff0000')
  })

  it('editing size edits the active pen', () => {
    useInkStore.getState().updateActivePen({ size: 9 })
    expect(activePenOf(useInkStore.getState()).size).toBe(9)
  })

  it('leaves the other pens alone when one is edited', () => {
    const before = useInkStore.getState().pens[1]!.color
    useInkStore.getState().updateActivePen({ color: '#00ff00' })

    expect(useInkStore.getState().pens[1]!.color).toBe(before)
  })

  it('persists the eraser mode', () => {
    useInkStore.getState().setEraserMode('stroke')

    expect(useInkStore.getState().eraserMode).toBe('stroke')
    expect(localStorage.getItem('null-notes.ink.eraserMode')).toBe('stroke')
  })

  it('clamps and persists the eraser size', () => {
    useInkStore.getState().setEraserSize(9999)

    const clamped = useInkStore.getState().eraserSize
    expect(clamped).toBeLessThan(9999)
    expect(localStorage.getItem('null-notes.ink.eraserSize')).toBe(String(clamped))
  })
})
```

Check the three storage keys against `src/ink/pens.ts` before running — use whatever `PENS_KEY`, `ACTIVE_PEN_KEY`, `ERASER_MODE_KEY` and `ERASER_SIZE_KEY` actually are, rather than the names above, if they differ.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/store/ink.test.ts`
Expected: FAIL — `Failed to resolve import "./ink"`.

- [ ] **Step 3: Write the implementation**

Create `src/store/ink.ts`:

```ts
import { create } from 'zustand'
import type { EraserMode, Pen, Tool } from '../ink/types'
import {
  DEFAULT_PENS,
  clampEraserSize,
  loadActivePenId,
  loadEraserMode,
  loadEraserSize,
  loadPens,
  saveActivePenId,
  saveEraserMode,
  saveEraserSize,
  savePens,
  withPen,
} from '../ink/pens'

// What is in your hand, as opposed to what is on the page. A pen is a pen
// wherever you draw, and this state was already shared — `ink/pens.ts` has
// always persisted it to localStorage, so every canvas in the app rendered
// its own copy of one set of values. The store makes that explicit; it does
// not change it. Strokes, history, selection, ruler and zoom stay per-canvas
// in `useInkCanvas`.
interface InkStore {
  tool: Tool
  pens: Pen[]
  activePenId: string
  eraserMode: EraserMode
  eraserSize: number
  setTool: (tool: Tool) => void
  selectPen: (id: string) => void
  updateActivePen: (changes: Partial<Pen>) => void
  setEraserMode: (mode: EraserMode) => void
  setEraserSize: (size: number) => void
}

export function activePenOf(state: Pick<InkStore, 'pens' | 'activePenId'>): Pen {
  return state.pens.find((pen) => pen.id === state.activePenId) ?? DEFAULT_PENS[0]
}

export const useInkStore = create<InkStore>((set, get) => ({
  tool: 'pen',
  pens: loadPens(),
  activePenId: loadActivePenId(loadPens()),
  eraserMode: loadEraserMode(),
  eraserSize: loadEraserSize(),

  setTool: (tool) => set({ tool }),

  // Reaching for a colour means you intend to draw with it.
  selectPen: (id) => {
    saveActivePenId(id)
    set({ activePenId: id, tool: 'pen' })
  },

  updateActivePen: (changes) => {
    const updated = withPen(get().pens, { ...activePenOf(get()), ...changes })
    savePens(updated)
    set({ pens: updated })
  },

  setEraserMode: (mode) => {
    saveEraserMode(mode)
    set({ eraserMode: mode })
  },

  setEraserSize: (size) => {
    const clamped = clampEraserSize(size)
    saveEraserSize(clamped)
    set({ eraserSize: clamped })
  },
}))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/store/ink.test.ts && npm run typecheck`
Expected: PASS, 9 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/ink.ts src/store/ink.test.ts
git commit -m "feat(ink): add a store for the tool state every canvas already shared"
```

---

### Task 2: `useInkCanvas` reads the store

**Files:**
- Modify: `src/ink/useInkCanvas.ts`
- Test: `src/ink/useInkCanvas.test.ts` (existing — must stay green unchanged)

**Interfaces:**
- Consumes: `useInkStore`, `activePenOf` from Task 1.
- Produces: `useInkCanvas` with its **return shape unchanged**, so `InkCanvas` needs no edit in this task. `tool`, `pens`, `activePenId`, `eraserMode`, `eraserSize`, `color`, `size` now come from the store rather than local state.

This task is behaviour-preserving by construction and is the one that can be reviewed on its own merits. Nothing visible changes.

- [ ] **Step 1: Delete the lifted local state**

In `src/ink/useInkCanvas.ts`, remove these five `useState` lines and their imports of the corresponding `load*` helpers:

```ts
const [tool, setTool] = useState<Tool>('pen')
const [pens, setPens] = useState<Pen[]>(loadPens)
const [activePenId, setActivePenId] = useState(() => loadActivePenId(loadPens()))
const [eraserSize, setEraserSizeState] = useState(loadEraserSize)
const [eraserMode, setEraserModeState] = useState<EraserMode>(loadEraserMode)
```

Replace with store reads:

```ts
const tool = useInkStore((s) => s.tool)
const pens = useInkStore((s) => s.pens)
const activePenId = useInkStore((s) => s.activePenId)
const eraserMode = useInkStore((s) => s.eraserMode)
const eraserSize = useInkStore((s) => s.eraserSize)
const setToolInStore = useInkStore((s) => s.setTool)
const selectPenInStore = useInkStore((s) => s.selectPen)
const updateActivePen = useInkStore((s) => s.updateActivePen)
const setEraserMode = useInkStore((s) => s.setEraserMode)
const setEraserSize = useInkStore((s) => s.setEraserSize)
```

Add the import:

```ts
import { useInkStore } from '../store/ink'
```

- [ ] **Step 2: Delete the setters the store now owns**

Remove the local `updateActivePen`, `setEraserMode` and `setEraserSize` callbacks entirely — the store's versions replace them, including their `savePens` / `saveEraserMode` / `saveEraserSize` calls. Keep `setColor` and `setSize`, which stay thin wrappers:

```ts
const setColor = useCallback(
  (next: string) => updateActivePen({ color: next }),
  [updateActivePen],
)
const setSize = useCallback(
  (next: number) => updateActivePen({ size: next }),
  [updateActivePen],
)
```

- [ ] **Step 3: Clear the selection on a tool change, in an effect**

`selectTool` used to do two things — set the tool and clear this canvas's selection. The tool now lives in the store, and the selection does not, so the two separate. Replace `selectTool` and `selectPen` with:

```ts
const selectTool = useCallback((next: Tool) => setToolInStore(next), [setToolInStore])
const selectPen = useCallback((id: string) => selectPenInStore(id), [selectPenInStore])

// The tool is shared, the selection is not: switching tools has to clear the
// selection in *every* canvas, not only the one whose button was pressed, or a
// lasso selection in another block outlives the tool that made it.
useEffect(() => {
  clearSelection()
}, [tool, clearSelection])
```

Place the effect after `clearSelection` is defined.

- [ ] **Step 4: Run the existing ink tests unchanged**

Run: `npx vitest run src/ink && npm run typecheck`
Expected: PASS, every existing ink test, with no edits to any of them.

If `useInkCanvas.test.ts` fails because state leaks between tests (the store is module-scoped and no longer resets per hook instance), add a `beforeEach` to *that test file only* resetting the store — that is a legitimate test-harness change, not a behaviour change:

```ts
beforeEach(() => {
  useInkStore.setState({ tool: 'pen', eraserMode: 'point', eraserSize: 12 })
})
```

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm test && npm run typecheck
git add src/ink/useInkCanvas.ts src/ink/useInkCanvas.test.ts
git commit -m "refactor(ink): read shared tool state from the store"
```

---

### Task 3: The active canvas

**Files:**
- Modify: `src/store/ink.ts`
- Modify: `src/ink/InkCanvas.tsx`
- Test: `src/store/ink.test.ts`, `src/ink/activeCanvas.test.tsx` (create)

**Interfaces:**
- Consumes: `useInkStore` from Task 1.
- Produces:
  - `CanvasHandle` — `{ undo(): void; redo(): void; canUndo: boolean; canRedo: boolean; deleteSelected(): void; hasSelection: boolean; toggleRuler(): void; rulerOn: boolean; zoom: number; setZoom(zoom: number): void }`
  - `useInkStore` gains `activeCanvas: CanvasHandle | null`, `setActiveCanvas(handle: CanvasHandle | null)`, `clearActiveCanvas()`.

Still no visible change: the per-canvas toolbar stays. This task only makes the target reachable.

- [ ] **Step 1: Write the failing store test**

Append to `src/store/ink.test.ts`:

```ts
import type { CanvasHandle } from './ink'

function handle(overrides: Partial<CanvasHandle> = {}): CanvasHandle {
  return {
    undo: () => {},
    redo: () => {},
    canUndo: false,
    canRedo: false,
    deleteSelected: () => {},
    hasSelection: false,
    toggleRuler: () => {},
    rulerOn: false,
    zoom: 1,
    setZoom: () => {},
    ...overrides,
  }
}

describe('the active canvas', () => {
  beforeEach(() => useInkStore.getState().clearActiveCanvas())

  it('has none to begin with', () => {
    expect(useInkStore.getState().activeCanvas).toBeNull()
  })

  it('remembers the canvas that registered', () => {
    const first = handle({ canUndo: true })
    useInkStore.getState().setActiveCanvas(first)

    expect(useInkStore.getState().activeCanvas?.canUndo).toBe(true)
  })

  it('replaces the previous one when another canvas registers', () => {
    useInkStore.getState().setActiveCanvas(handle({ zoom: 1 }))
    useInkStore.getState().setActiveCanvas(handle({ zoom: 2 }))

    expect(useInkStore.getState().activeCanvas?.zoom).toBe(2)
  })

  it('clears', () => {
    useInkStore.getState().setActiveCanvas(handle())
    useInkStore.getState().clearActiveCanvas()

    expect(useInkStore.getState().activeCanvas).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/store/ink.test.ts`
Expected: FAIL — `CanvasHandle` is not exported; `setActiveCanvas` is not a function.

- [ ] **Step 3: Add the handle to the store**

In `src/store/ink.ts`, add above `InkStore`:

```ts
/** What the toolbar can do to the canvas being drawn in.
 *
 * Everything here is per-canvas by nature: two canvases have separate
 * histories, separate selections, separate rulers and separate zoom. None of
 * it could live in the store itself without meaning the wrong thing. */
export interface CanvasHandle {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  deleteSelected: () => void
  hasSelection: boolean
  toggleRuler: () => void
  rulerOn: boolean
  zoom: number
  setZoom: (zoom: number) => void
}
```

Add to the `InkStore` interface:

```ts
  activeCanvas: CanvasHandle | null
  setActiveCanvas: (handle: CanvasHandle) => void
  clearActiveCanvas: () => void
```

And to the store body:

```ts
  activeCanvas: null,
  setActiveCanvas: (handle) => set({ activeCanvas: handle }),
  clearActiveCanvas: () => set({ activeCanvas: null }),
```

- [ ] **Step 4: Run the store tests**

Run: `npx vitest run src/store/ink.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Write the failing registration test**

Create `src/ink/activeCanvas.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { InkCanvas } from './InkCanvas'
import { useInkStore } from '../store/ink'

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
  },
}))

beforeEach(() => useInkStore.getState().clearActiveCanvas())
afterEach(cleanup)

describe('registering the canvas being drawn in', () => {
  it('registers on pointerdown', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} />)

    const canvas = container.querySelector('canvas')!
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })

    await waitFor(() => expect(useInkStore.getState().activeCanvas).not.toBeNull())
  })

  it('clears when it unmounts while active', async () => {
    const { container, unmount } = render(
      <InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} />,
    )
    fireEvent.pointerDown(container.querySelector('canvas')!, { clientX: 10, clientY: 10, pointerId: 1 })
    await waitFor(() => expect(useInkStore.getState().activeCanvas).not.toBeNull())

    unmount()

    expect(useInkStore.getState().activeCanvas).toBeNull()
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/ink/activeCanvas.test.tsx`
Expected: FAIL — `activeCanvas` stays `null`.

- [ ] **Step 7: Register from `InkCanvas`**

In `src/ink/InkCanvas.tsx`, add the imports:

```tsx
import { useEffect } from 'react'
import { useInkStore } from '../store/ink'
```

Inside the component, after the `useInkCanvas` destructuring, add:

```tsx
const setActiveCanvas = useInkStore((s) => s.setActiveCanvas)
const clearActiveCanvas = useInkStore((s) => s.clearActiveCanvas)

// Re-registered whenever a value the bar renders changes, so `canUndo` in the
// toolbar tracks the stroke that was just drawn rather than the state when the
// pen first touched down.
const isActive = useInkStore((s) => s.activeCanvas) !== null && activeHere.current
const activeHere = useRef(false)

useEffect(() => {
  if (!activeHere.current) return
  setActiveCanvas({
    undo, redo, canUndo, canRedo,
    deleteSelected, hasSelection,
    toggleRuler, rulerOn: ruler !== null,
    zoom, setZoom: (next: number) => onZoomChange?.(next),
  })
}, [
  undo, redo, canUndo, canRedo, deleteSelected, hasSelection,
  toggleRuler, ruler, zoom, onZoomChange, setActiveCanvas,
])

useEffect(() => () => {
  if (activeHere.current) clearActiveCanvas()
}, [clearActiveCanvas])
```

Declare `activeHere` before the effects and drop the unused `isActive` line if the linter objects — it is there only if a later task needs it; delete it now if not.

In `handlePointerDown`, as the first statement:

```tsx
activeHere.current = true
setActiveCanvas({
  undo, redo, canUndo, canRedo,
  deleteSelected, hasSelection,
  toggleRuler, rulerOn: ruler !== null,
  zoom, setZoom: (next: number) => onZoomChange?.(next),
})
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/ink && npm run typecheck`
Expected: PASS, including both new tests and every existing ink test.

- [ ] **Step 9: Commit**

```bash
git add src/store/ink.ts src/store/ink.test.ts src/ink/InkCanvas.tsx src/ink/activeCanvas.test.tsx
git commit -m "feat(ink): let the canvas being drawn in register itself"
```

---

### Task 4: The toolbar, and deleting the per-canvas one

**Files:**
- Create: `src/editor/toolbar/EditorToolbar.tsx`, `src/editor/toolbar/InkToolGroup.tsx`
- Modify: `src/ink/InkCanvas.tsx` (delete its toolbar), `src/editor/NoteEditor.tsx`, `src/index.css`
- Test: `src/editor/toolbar/editorToolbar.test.tsx` (create)

**Interfaces:**
- Consumes: `useInkStore`, `activePenOf`, `CanvasHandle` from Tasks 1 and 3.
- Produces: `EditorToolbar({ editor, notePath })`, `InkToolGroup()`.

This is the only task with a visible change. It must land as one commit: the per-canvas toolbar is currently the sole route to ink undo, so removing it before the bar exists would leave undo unreachable.

- [ ] **Step 1: Write the failing test**

Create `src/editor/toolbar/editorToolbar.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { EditorToolbar } from './EditorToolbar'
import { useInkStore } from '../../store/ink'
import type { CanvasHandle } from '../../store/ink'

vi.mock('../../lib/ink', () => ({
  inkApi: { ensureDir: () => Promise.resolve('/ws/N.ink'), write: () => Promise.resolve() },
}))

function handle(overrides: Partial<CanvasHandle> = {}): CanvasHandle {
  return {
    undo: () => {}, redo: () => {}, canUndo: false, canRedo: false,
    deleteSelected: () => {}, hasSelection: false,
    toggleRuler: () => {}, rulerOn: false,
    zoom: 1, setZoom: () => {},
    ...overrides,
  }
}

beforeEach(() => useInkStore.getState().clearActiveCanvas())
afterEach(cleanup)

describe('the editor toolbar', () => {
  it('shows no drawing tools when no canvas is active', () => {
    const { queryByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    expect(queryByLabelText('Pen')).toBeNull()
  })

  it('shows the drawing tools once a canvas is active', () => {
    useInkStore.getState().setActiveCanvas(handle())
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    expect(getByLabelText('Pen')).toBeInTheDocument()
    expect(getByLabelText('Eraser')).toBeInTheDocument()
  })

  it('undo acts on the active canvas', () => {
    const undo = vi.fn()
    useInkStore.getState().setActiveCanvas(handle({ canUndo: true, undo }))
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    fireEvent.click(getByLabelText('Undo'))

    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('disables undo when the active canvas has nothing to undo', () => {
    useInkStore.getState().setActiveCanvas(handle({ canUndo: false }))
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    expect(getByLabelText('Undo')).toBeDisabled()
  })

  // The load-bearing rule. Reaching for undo must not deselect the canvas that
  // undo is meant to act on, so the bar never lets a press move focus.
  it('does not clear the active canvas when a button is pressed', () => {
    useInkStore.getState().setActiveCanvas(handle({ canUndo: true }))
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    fireEvent.mouseDown(getByLabelText('Undo'))

    expect(useInkStore.getState().activeCanvas).not.toBeNull()
  })

  it('selecting a tool changes the shared tool', () => {
    useInkStore.getState().setActiveCanvas(handle())
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    fireEvent.click(getByLabelText('Eraser'))

    expect(useInkStore.getState().tool).toBe('eraser')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/editor/toolbar/editorToolbar.test.tsx`
Expected: FAIL — `Failed to resolve import "./EditorToolbar"`.

- [ ] **Step 3: Move the toolbar markup into `InkToolGroup`**

Create `src/editor/toolbar/InkToolGroup.tsx`. Move the entire `<div className="ink-toolbar">` block out of `src/ink/InkCanvas.tsx` verbatim, then rewire its sources: `tool`/`pens`/`activePenId`/`eraserMode`/`eraserSize` come from `useInkStore`; `color` and `size` from `activePenOf`; `undo`/`redo`/`canUndo`/`canRedo`/`deleteSelected`/`hasSelection`/`toggleRuler`/`rulerOn`/`zoom`/`setZoom` from `activeCanvas`. Keep `TOOLS`, `ERASER_MODES`, `ZOOM_LEVELS` and `swatchDiameter` — move them into this file, since `InkCanvas` no longer needs them.

The wrapper becomes:

```tsx
export function InkToolGroup() {
  const active = useInkStore((s) => s.activeCanvas)
  const tool = useInkStore((s) => s.tool)
  const pens = useInkStore((s) => s.pens)
  const activePenId = useInkStore((s) => s.activePenId)
  const eraserMode = useInkStore((s) => s.eraserMode)
  const eraserSize = useInkStore((s) => s.eraserSize)
  const setTool = useInkStore((s) => s.setTool)
  const selectPen = useInkStore((s) => s.selectPen)
  const updateActivePen = useInkStore((s) => s.updateActivePen)
  const setEraserMode = useInkStore((s) => s.setEraserMode)
  const setEraserSize = useInkStore((s) => s.setEraserSize)
  const { color, size } = activePenOf({ pens, activePenId })

  if (!active) return null

  return (
    <div className="toolbar-group toolbar-ink" role="group" aria-label="Drawing tools">
      {/* the moved markup, with setColor -> updateActivePen({ color: … })
          and setSize -> updateActivePen({ size: … }) */}
    </div>
  )
}
```

- [ ] **Step 4: Write `EditorToolbar`**

Create `src/editor/toolbar/EditorToolbar.tsx`:

```tsx
import type { Editor } from '@tiptap/core'
import { useInkStore } from '../../store/ink'
import { InkToolGroup } from './InkToolGroup'

interface EditorToolbarProps {
  editor: Editor | null
  notePath: string
}

// One bar, one group at a time. A canvas being active means a pen is in hand,
// and then nothing else in the bar is what you want — so the ink group takes
// it alone rather than sharing a row it could not fit in anyway.
export function EditorToolbar({ editor, notePath }: EditorToolbarProps) {
  const drawing = useInkStore((s) => s.activeCanvas) !== null

  return (
    <div
      className="editor-toolbar"
      role="toolbar"
      aria-label="Editor"
      // Never let a press move focus or the selection: clicking undo would
      // otherwise clear the very canvas undo is meant to act on.
      onMouseDown={(e) => e.preventDefault()}
    >
      {drawing ? <InkToolGroup /> : null}
    </div>
  )
}
```

`editor` and `notePath` are unused until Tasks 5–7. Keep them in the props so those tasks are additive, and satisfy the linter by prefixing with `void editor; void notePath;`— or omit them here and add them in Task 5, whichever the project's lint settings prefer.

- [ ] **Step 5: Mount it in `NoteEditor` and make it sticky**

In `src/editor/NoteEditor.tsx`, replace the existing `<div className="editor-toolbar">…</div>` with `<EditorToolbar editor={editor} notePath={notePath} />`, keeping the existing Ink button and code-language select by moving them into `EditorToolbar` for now (they return in Tasks 6 and 5 respectively).

In `src/index.css`, extend the existing `.editor-toolbar` rule:

```css
.editor-toolbar {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
  /* One row that scrolls, never one that wraps: a bar which changes height
     when you switch tools shifts the note under your pen mid-stroke. */
  overflow-x: auto;
  flex-wrap: nowrap;
}
```

- [ ] **Step 5a: Clear the active canvas when the caret lands in text**

`NoteEditor` already subscribes to `selectionUpdate` to bump `editorVersion`. Add one line to that same handler:

```tsx
const onSelectionUpdate = () => {
  setEditorVersion((version) => version + 1)
  rememberPosition(notePath, { selection: editor.state.selection.anchor })
  // A canvas pointerdown does not move the ProseMirror selection, and the bar
  // preventDefaults its own presses, so this fires only when the caret really
  // lands in prose — which is exactly when the drawing tools should go away.
  useInkStore.getState().clearActiveCanvas()
}
```

Add a test for it in `src/editor/toolbar/editorToolbar.test.tsx`:

```tsx
it('clears the active canvas when the caret moves into text', async () => {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content: '<p>hello</p>',
  })
  useInkStore.getState().setActiveCanvas(handle())

  editor.commands.setTextSelection(2)
  editor.emit('selectionUpdate', { editor, transaction: editor.state.tr })

  await waitFor(() => expect(useInkStore.getState().activeCanvas).toBeNull())
  editor.destroy()
})
```

If wiring the emit proves awkward, assert the behaviour through `NoteEditor` instead — render it, register a handle, click into the prose, and expect the handle cleared. Either is a real test of the rule; do not skip it.

- [ ] **Step 6: Delete the toolbar from `InkCanvas`**

Remove the `<div className="ink-toolbar">…</div>` block and every import it alone used (the lucide icons, `TOOLS`, `ERASER_MODES`, `ZOOM_LEVELS`, `swatchDiameter`). `InkCanvas` keeps only the drawing surface and its pointer handlers.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck`
Expected: PASS. `src/ink/*` tests unchanged; the new toolbar tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/editor/toolbar src/editor/NoteEditor.tsx src/ink/InkCanvas.tsx src/index.css
git commit -m "feat(editor): one sticky toolbar instead of one per canvas"
```

---

### Task 5: The text-formatting group

**Files:**
- Create: `src/editor/toolbar/TextFormatGroup.tsx`
- Modify: `src/editor/toolbar/EditorToolbar.tsx`
- Test: `src/editor/toolbar/textFormatGroup.test.tsx` (create)

**Interfaces:**
- Consumes: `Editor` from `@tiptap/core`.
- Produces: `TextFormatGroup({ editor })`.

- [ ] **Step 1: Write the failing test**

Create `src/editor/toolbar/textFormatGroup.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { coreExtensions } from '../extensions'
import { TextFormatGroup } from './TextFormatGroup'

let editor: Editor | null = null

function mount(content: string) {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  editor.commands.selectAll()
  return render(<TextFormatGroup editor={editor} />)
}

afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
})

describe('the text formatting group', () => {
  it('bolds the selection', async () => {
    const { getByLabelText } = mount('<p>hello</p>')

    fireEvent.click(getByLabelText('Bold'))

    await waitFor(() => expect(editor!.isActive('bold')).toBe(true))
  })

  it('marks the button active when the selection is already bold', async () => {
    const { getByLabelText } = mount('<p><strong>hello</strong></p>')

    await waitFor(() => expect(getByLabelText('Bold')).toHaveAttribute('aria-pressed', 'true'))
  })

  it('turns the selection into a heading', async () => {
    const { getByLabelText } = mount('<p>hello</p>')

    fireEvent.click(getByLabelText('Heading 2'))

    await waitFor(() => expect(editor!.isActive('heading', { level: 2 })).toBe(true))
  })

  it('turns the selection into a bullet list', async () => {
    const { getByLabelText } = mount('<p>hello</p>')

    fireEvent.click(getByLabelText('Bullet list'))

    await waitFor(() => expect(editor!.isActive('bulletList')).toBe(true))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/editor/toolbar/textFormatGroup.test.tsx`
Expected: FAIL — `Failed to resolve import "./TextFormatGroup"`.

- [ ] **Step 3: Write it**

Create `src/editor/toolbar/TextFormatGroup.tsx`:

```tsx
import { Bold, Italic, List, ListOrdered } from 'lucide-react'
import type { Editor } from '@tiptap/core'

interface TextFormatGroupProps {
  editor: Editor
}

const HEADINGS = [1, 2, 3] as const

export function TextFormatGroup({ editor }: TextFormatGroupProps) {
  return (
    <div className="toolbar-group" role="group" aria-label="Formatting">
      <button
        className={`toolbar-button${editor.isActive('bold') ? ' active' : ''}`}
        aria-pressed={editor.isActive('bold')}
        aria-label="Bold"
        title="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </button>
      <button
        className={`toolbar-button${editor.isActive('italic') ? ' active' : ''}`}
        aria-pressed={editor.isActive('italic')}
        aria-label="Italic"
        title="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} />
      </button>
      <span className="toolbar-sep" aria-hidden />
      {HEADINGS.map((level) => (
        <button
          key={level}
          className={`toolbar-button${editor.isActive('heading', { level }) ? ' active' : ''}`}
          aria-pressed={editor.isActive('heading', { level })}
          aria-label={`Heading ${level}`}
          title={`Heading ${level}`}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
        >
          H{level}
        </button>
      ))}
      <span className="toolbar-sep" aria-hidden />
      <button
        className={`toolbar-button${editor.isActive('bulletList') ? ' active' : ''}`}
        aria-pressed={editor.isActive('bulletList')}
        aria-label="Bullet list"
        title="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </button>
      <button
        className={`toolbar-button${editor.isActive('orderedList') ? ' active' : ''}`}
        aria-pressed={editor.isActive('orderedList')}
        aria-label="Numbered list"
        title="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Render it, keeping the code-language select in its place**

In `EditorToolbar`, replace the `null` branch:

```tsx
{drawing ? (
  <InkToolGroup />
) : (
  editor && (editor.isActive('codeBlock')
    ? <CodeLanguageSelect editor={editor} />
    : <TextFormatGroup editor={editor} />)
)}
```

`CodeLanguageSelect` is the existing select, extracted from `NoteEditor` into `src/editor/toolbar/CodeLanguageSelect.tsx` unchanged — same options, same `updateAttributes` call.

The bar must re-render as the selection moves, or `isActive` goes stale. `NoteEditor` already bumps `editorVersion` on `selectionUpdate`; make sure `EditorToolbar` is rendered inside that component so it re-renders with it.

- [ ] **Step 5: Run and commit**

```bash
npm test && npm run typecheck
git add src/editor/toolbar
git commit -m "feat(editor): add text formatting to the toolbar"
```

---

### Task 6: The insert group

**Files:**
- Create: `src/editor/toolbar/InsertGroup.tsx`
- Modify: `src/editor/toolbar/EditorToolbar.tsx`
- Test: `src/editor/toolbar/insertGroup.test.tsx` (create)

**Interfaces:**
- Consumes: `Editor`; `inkApi` from `src/lib/ink`; `SOLUTION_INK_WIDTH`, `SOLUTION_INK_HEIGHT` are *not* used here — a hand-inserted canvas keeps the existing 700×900 default from `NoteEditor`'s `INK_WIDTH`/`INK_HEIGHT`.
- Produces: `InsertGroup({ editor, notePath })`.

- [ ] **Step 1: Write the failing test**

Create `src/editor/toolbar/insertGroup.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { coreExtensions } from '../extensions'
import { InsertGroup } from './InsertGroup'

vi.mock('../../lib/ink', () => ({
  inkApi: { ensureDir: () => Promise.resolve('/ws/N.ink'), write: () => Promise.resolve() },
}))

let editor: Editor | null = null

function mount() {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content: '<p></p>' })
  editor.storage.noteContext.notePath = '/ws/N.md'
  return render(<InsertGroup editor={editor} notePath="/ws/N.md" />)
}

function nodeTypes(): string[] {
  const found: string[] = []
  editor!.state.doc.descendants((node) => { found.push(node.type.name); return true })
  return found
}

afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
})

describe('the insert group', () => {
  it('inserts a block equation', async () => {
    const { getByLabelText } = mount()

    fireEvent.click(getByLabelText('Insert equation'))

    await waitFor(() => expect(nodeTypes()).toContain('blockMath'))
  })

  it('inserts a table', async () => {
    const { getByLabelText } = mount()

    fireEvent.click(getByLabelText('Insert table'))

    await waitFor(() => expect(nodeTypes()).toContain('table'))
  })

  it('inserts a code block', async () => {
    const { getByLabelText } = mount()

    fireEvent.click(getByLabelText('Insert code block'))

    await waitFor(() => expect(nodeTypes()).toContain('codeBlock'))
  })

  it('inserts an ink canvas backed by a sidecar', async () => {
    const { getByLabelText } = mount()

    fireEvent.click(getByLabelText('Insert ink canvas'))

    await waitFor(() => expect(nodeTypes()).toContain('inkBlock'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/editor/toolbar/insertGroup.test.tsx`
Expected: FAIL — `Failed to resolve import "./InsertGroup"`.

- [ ] **Step 3: Write it**

Create `src/editor/toolbar/InsertGroup.tsx` with five buttons calling the same commands the slash menu already uses, so there is one behaviour with two entry points:

```tsx
import { PenLine, Sigma, Table, Code, Info } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { inkApi } from '../../lib/ink'
import type { InkData } from '../../ink/types'

interface InsertGroupProps {
  editor: Editor
  notePath: string
}

const INK_WIDTH = 700
const INK_HEIGHT = 900
const EMPTY_INK: InkData = { width: INK_WIDTH, height: INK_HEIGHT, strokes: [], shapes: [] }

export function InsertGroup({ editor, notePath }: InsertGroupProps) {
  async function insertInk() {
    const dir = await inkApi.ensureDir(notePath)
    const sep = dir.includes('\\') ? '\\' : '/'
    const svgPath = `${dir}${sep}sketch-${Date.now()}.svg`
    await inkApi.write(svgPath, EMPTY_INK)
    editor.commands.insertContent({
      type: 'inkBlock',
      attrs: { src: svgPath, width: INK_WIDTH, height: INK_HEIGHT },
    })
  }

  return (
    <div className="toolbar-group" role="group" aria-label="Insert">
      <button className="toolbar-button" aria-label="Insert ink canvas" title="Insert ink canvas"
        onClick={() => void insertInk()}>
        <PenLine size={15} />
      </button>
      <button className="toolbar-button" aria-label="Insert equation" title="Insert equation"
        onClick={() => editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: '' } }).run()}>
        <Sigma size={15} />
      </button>
      <button className="toolbar-button" aria-label="Insert table" title="Insert table"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table size={15} />
      </button>
      <button className="toolbar-button" aria-label="Insert code block" title="Insert code block"
        onClick={() => editor.chain().focus().setCodeBlock().run()}>
        <Code size={15} />
      </button>
      <button className="toolbar-button" aria-label="Insert callout" title="Insert callout"
        onClick={() => editor.chain().focus()
          .insertContent({ type: 'callout', attrs: { calloutType: 'note', title: '' }, content: [{ type: 'paragraph' }] })
          .run()}>
        <Info size={15} />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Render it and remove the old Ink button**

Add `<InsertGroup editor={editor} notePath={notePath} />` beside `TextFormatGroup` in the non-drawing branch, and delete the standalone Ink button `EditorToolbar` inherited from `NoteEditor` in Task 4 — it is now one of the five.

- [ ] **Step 5: Run and commit**

```bash
npm test && npm run typecheck
git add src/editor/toolbar src/editor/NoteEditor.tsx
git commit -m "feat(editor): add an insert group to the toolbar"
```

---

### Task 7: The exercise-sheet group

**Files:**
- Create: `src/editor/toolbar/SheetGroup.tsx`
- Modify: `src/editor/toolbar/EditorToolbar.tsx`
- Test: `src/editor/toolbar/sheetGroup.test.tsx` (create)

**Interfaces:**
- Consumes: `splitIntoTasks`, `addNextTask`, `report` from `src/editor/splitIntoTasks`; `nextTaskLabel` from `src/lib/taskScaffold`.
- Produces: `SheetGroup({ editor })`.

- [ ] **Step 1: Write the failing test**

Create `src/editor/toolbar/sheetGroup.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'

const splitIntoTasks = vi.fn(() => Promise.resolve('split' as const))
const addNextTask = vi.fn(() => Promise.resolve())
vi.mock('../splitIntoTasks', () => ({
  splitIntoTasks: (...args: unknown[]) => splitIntoTasks(...(args as [])),
  addNextTask: (...args: unknown[]) => addNextTask(...(args as [])),
  report: () => {},
}))

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('../extensions')
const { SheetGroup } = await import('./SheetGroup')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return render(<SheetGroup editor={editor} />)
}

afterEach(() => {
  editor?.destroy()
  editor = null
  splitIntoTasks.mockClear()
  addNextTask.mockClear()
  cleanup()
})

describe('the exercise sheet group', () => {
  it('runs Split Into Tasks', async () => {
    const { getByLabelText } = mount('<p>1. Erste</p>')

    fireEvent.click(getByLabelText('Split into tasks'))

    await waitFor(() => expect(splitIntoTasks).toHaveBeenCalledTimes(1))
  })

  it('appends the next task', async () => {
    const { getByLabelText } = mount('<h2>Task 1</h2><h3>Solution</h3>')

    fireEvent.click(getByLabelText('Add next task'))

    await waitFor(() => expect(addNextTask).toHaveBeenCalledTimes(1))
  })

  it('passes the next label, counted from the note', async () => {
    const { getByLabelText } = mount('<h2>Task 3</h2><h3>Solution</h3>')

    fireEvent.click(getByLabelText('Add next task'))

    await waitFor(() => expect(addNextTask.mock.calls[0]?.[1]).toBe('4'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/editor/toolbar/sheetGroup.test.tsx`
Expected: FAIL — `Failed to resolve import "./SheetGroup"`.

- [ ] **Step 3: Write it**

Create `src/editor/toolbar/SheetGroup.tsx`:

```tsx
import { SplitSquareVertical, Plus } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { splitIntoTasks, addNextTask, report } from '../splitIntoTasks'
import { nextTaskLabel } from '../../lib/taskScaffold'

interface SheetGroupProps {
  editor: Editor
}

function markdownOf(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

export function SheetGroup({ editor }: SheetGroupProps) {
  return (
    <div className="toolbar-group" role="group" aria-label="Exercise sheet">
      <button
        className="toolbar-button"
        aria-label="Split into tasks"
        title="Rewrite this note as Task / Solution sections with a canvas each"
        onClick={() => {
          void splitIntoTasks(editor)
            .then((outcome) => {
              if (outcome === 'no-structure') {
                alert('No exercise structure found in this note — nothing was changed.')
              }
            })
            .catch(report)
        }}
      >
        <SplitSquareVertical size={15} />
      </button>
      <button
        className="toolbar-button"
        aria-label="Add next task"
        title="Append the next numbered Task and Solution pair"
        onClick={() => {
          void addNextTask(editor, nextTaskLabel(markdownOf(editor))).catch(report)
        }}
      >
        <Plus size={15} />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Render it**

Add `<SheetGroup editor={editor} />` to the non-drawing branch of `EditorToolbar`, after `InsertGroup`.

- [ ] **Step 5: Run the whole suite, build, and commit**

```bash
npm test && npm run typecheck && npm run build
git add src/editor/toolbar
git commit -m "feat(editor): add the exercise-sheet actions to the toolbar"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| State split — store owns tool/pens/activePen/eraserMode/eraserSize | 1 |
| `pens.ts` stays the only `localStorage` layer | 1 (store calls its helpers; constraint restated globally) |
| Colour and size derive from the active pen, not separate state | 1 (`activePenOf`, `updateActivePen`), 2 (`setColor`/`setSize` wrappers) |
| Strokes, history, selection, lasso, ruler, zoom stay per-canvas | 2 (nothing lifted), 3 (`CanvasHandle` exposes, does not own) |
| Ruler is per-canvas; only the toggle reaches the bar | 3 (`toggleRuler`, `rulerOn` on the handle) |
| Active canvas registers on pointerdown | 3 |
| Cleared on unmount / note change | 3 |
| **Never cleared by the toolbar** | 4 (`onMouseDown` preventDefault + its own test) |
| Ink group only when a canvas is active | 4 |
| Ink group takes the bar alone | 4 (`drawing ? … : …`) |
| Text group, code-language select in its place | 5 |
| Insert group | 6 |
| Sheet actions group | 7 |
| Sticky at top of editor pane | 4 (CSS) |
| Single row, horizontal scroll, no wrap | 4 (CSS) |
| `InkCanvas` becomes the drawing surface only | 4 |
| Existing ink tests unchanged | Global constraint; verified in 2 and 4 |
| Undo acts on the active canvas, not another | 4 |

**Gap found and closed:** the spec's clearing rule "when the ProseMirror selection moves to a text position" had no task — it needs the editor, which `InkCanvas` does not have. Now **Task 4, Step 5a**: one line on the `selectionUpdate` handler `NoteEditor` already runs, with its own test. Folded into Task 4 rather than given its own, because it is inseparable from the task that makes the bar contextual in the first place.

**Placeholder scan:** no TBD/TODO; every code step carries real code. Task 4 Step 3 says "the moved markup" rather than reproducing ~120 lines verbatim — acceptable because the instruction is a literal move of an existing block with a named, enumerated set of rewires, not a description of code to invent.

**Type consistency:** `CanvasHandle` has identical members in Task 3's store definition, Task 3's test helper and Task 4's test helper. `activePenOf` takes `Pick<InkStore, 'pens' | 'activePenId'>` in Task 1 and is called with `{ pens, activePenId }` in Task 4. `setTool`, `selectPen`, `updateActivePen`, `setEraserMode`, `setEraserSize` are named identically in Tasks 1, 2 and 4. `addNextTask(editor, label)` in Task 7 matches its existing signature in `src/editor/splitIntoTasks.ts`.
