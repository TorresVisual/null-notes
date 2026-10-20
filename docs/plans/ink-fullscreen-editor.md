# Full-Screen Ink Editor Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Adding a canvas to a note opens a full-window drawing surface; in the note, an ink block is a static preview that re-opens that editor.

**Architecture:** A new `InkEditorOverlay` portal wraps the existing `InkCanvas` (which already writes the sidecar as strokes commit). `InkBlock`'s node view splits in two: an `inline: true` fence flag keeps today's inline `InkCanvas` (canvas notes), everything else renders a sanitized SVG preview that opens the overlay. `InkCanvas`/`useInkCanvas` gain an `onSaved` callback so the preview refreshes when a write lands.

**Tech Stack:** React 19 + TypeScript (strict), TipTap 3 node views, Zustand (`useInkStore`), Vitest + Testing Library, WebdriverIO (e2e).

**Spec:** `docs/specs/ink-fullscreen-editor-design.md`

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

- No freeform 2D canvas; the ink block stays one block in the Markdown flow (spec Non-Goals, `docs/ROADMAP.md` §1).
- No toolbar redesign, infinite page or pen-feel changes. The overlay never resizes the stored page (spec Non-Goals; sub-projects 2–4).
- `PdfPageBlock`'s ink overlay keeps using `InkCanvas` inline — unchanged.
- No storage change: the `NoteName.ink/*.svg` sidecar stays inside the workspace.
- Fence JSON: `inline` is optional, parsed as `false` when absent, serialized **only** when `true`.
- The sidecar SVG is a synced workspace file: it passes through `sanitizeNoteHtml` before `dangerouslySetInnerHTML`.
- Preview scales the whole page to fit a max height of ~320px, uncropped.
- Edit button and click-to-open work only when `editor.isEditable`.
- TypeScript strict: no `any`, no unexplained `!`. Named exports; one component per file; no comments unless the WHY is non-obvious.
- Every new className must have a matching rule in `src/index.css` (CLAUDE.md "Dialog CSS gap") — verify by screenshot, not by grep alone.
- `npm run lint` does not exist; verification is `npm run typecheck` and `npm test`.

## Review Focus

Failure modes the spec implies that the plain happy-path tests would not catch, most likely first. Each has a test in the task named in brackets.

1. **Esc while typing a label** must cancel the label, not close the overlay and drop the drawing session. [Task 3]
2. **Ctrl+Z before the first stroke** while a *different* canvas owns the active slot must not undo that other canvas (or the note). [Task 3]
3. **Clicking Done with a label still open** must still save that label and refresh the preview — the write happens in `useInkCanvas`'s unmount flush, not through `commit`. [Task 2, Task 4]
4. **Two quick saves whose sidecar reads resolve out of order** must leave the preview on the newest data, not the older read. [Task 4]
5. **Read-only note** (`editor.isEditable === false`): preview is inert — no Edit button, click and `ink:auto-open` do nothing. [Task 4]

---

## File Structure

| File | Change |
|---|---|
| `src/ink/InkEditorOverlay.tsx` | Create — portal, header (`InkToolGroup` + Done), scroll body wrapping `InkCanvas`, keyboard handling |
| `src/ink/inkEditorOverlay.test.tsx` | Create — overlay tests |
| `src/ink/InkCanvas.tsx` | Modify — `onSaved` + `autoActivate` props; exported `scrollAncestors` finds `.ink-editor-body` |
| `src/ink/useInkCanvas.ts` | Modify — `onSaved` option; one `save()` helper replacing 7 `inkApi.write` call sites |
| `src/ink/inkCanvasSaved.test.tsx` | Create — `onSaved`, `autoActivate`, `scrollAncestors` tests |
| `src/editor/extensions/InkBlock.ts` | Modify — `inline` attr, fence parse/serialize; node view moves out |
| `src/editor/extensions/InkBlockView.tsx` | Create — node view: empty wrapper / inline canvas / preview |
| `src/editor/extensions/InkPreview.tsx` | Create — static preview, Edit button, auto-open listener, overlay host |
| `src/editor/extensions/inkBlockFence.test.ts` | Create — fence round-trip |
| `src/editor/extensions/inkBlockMount.test.tsx` | Modify — preview/inline/overlay mount tests |
| `src/editor/toolbar/insertInk.ts` | Modify — dispatch `ink:auto-open` |
| `src/editor/toolbar/insertInk.test.ts` | Create |
| `src/editor/extensions/SlashCommands.tsx` | Modify — "Ink Block" calls `insertInk` (drops its duplicate copy) |
| `src/lib/canvasNote.ts`, `src/lib/canvasNote.test.ts` | Modify — write `inline: true` |
| `src/index.css` | Modify — overlay + preview styles |
| `e2e/specs/ink-fullscreen-editor.e2e.ts` | Create |

Deviations from the spec's file table, with reasons: the node view moves to `InkBlockView.tsx`/`InkPreview.tsx` because `InkBlock.ts` cannot hold JSX and CLAUDE.md wants one component per file; `SlashCommands.tsx` is touched because its "Ink Block" item carries a private copy of the insert sequence that would otherwise skip `ink:auto-open`; `InkCanvas` gets an `autoActivate` prop because `InkToolGroup` renders nothing until a canvas has registered, and registration otherwise only happens on pointer-down — the overlay header would be empty on open.

---

### Task 1: `inline` fence flag and canvas-note marker

**Files:**
- Modify: `src/editor/extensions/InkBlock.ts`
- Modify: `src/lib/canvasNote.ts`
- Modify: `src/lib/canvasNote.test.ts`
- Test: `src/editor/extensions/inkBlockFence.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `inkBlock` node attr `inline: boolean` (default `false`) — Tasks 4 reads it as `node.attrs.inline`; `canvasNoteBody` writes `"inline":true`.

- [ ] **Step 1: Write the failing tests**

Create `src/editor/extensions/inkBlockFence.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function load(fenceJson: string) {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content: '```ink\n' + fenceJson + '\n```',
  })
  const attrs: Array<Record<string, unknown>> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'inkBlock') attrs.push(node.attrs)
    return true
  })
  const markdown = (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
  return { attrs: attrs[0], markdown }
}

describe('the ink fence', () => {
  it('parses a fence without the flag as not inline, and does not write one back', () => {
    const { attrs, markdown } = load('{"src":"/ws/N.ink/a.svg","width":700,"height":400}')

    expect(attrs?.inline).toBe(false)
    expect(markdown).toContain('{"src":"/ws/N.ink/a.svg","width":700,"height":400}')
    expect(markdown).not.toContain('inline')
  })

  it('keeps inline: true through parse and serialize', () => {
    const { attrs, markdown } = load('{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":true}')

    expect(attrs?.inline).toBe(true)
    expect(markdown).toContain('{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":true}')
  })

  it('treats inline: false in a hand-edited fence as not inline and drops it', () => {
    const { attrs, markdown } = load('{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":false}')

    expect(attrs?.inline).toBe(false)
    expect(markdown).not.toContain('inline')
  })
})
```

In `src/lib/canvasNote.test.ts`, replace the expectation in `'writes an ink block the editor already understands'`:

```ts
expect(body).toContain(
  '```ink\n{"src":"Lecture 07.ink/page.svg","width":900,"height":1200,"inline":true}\n```',
)
```

and add to the `'survives Windows paths'` test's neighbour a new test:

```ts
  // Without the flag a canvas note would open as a preview, and the page it exists for would need a click.
  it('marks the block inline', () => {
    const fence = canvasNoteBody('T', 'x.svg', 900, 1200).match(/```ink\n([\s\S]*?)\n```/)?.[1] ?? ''
    expect((JSON.parse(fence) as { inline: boolean }).inline).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/editor/extensions/inkBlockFence.test.ts src/lib/canvasNote.test.ts`
Expected: FAIL — `attrs?.inline` is `undefined`; canvas-note fence lacks `"inline":true`.

- [ ] **Step 3: Implement**

`src/lib/canvasNote.ts` — change the fence line:

```ts
  const fence = JSON.stringify({ src, width, height, inline: true })
```

`src/editor/extensions/InkBlock.ts`:

- `InkBlockAttrs` gains `inline: boolean`.
- `addAttributes()` gains `inline: { default: false },`.
- `parseHTML` `getAttrs` gains `inline: (el as HTMLElement).getAttribute('data-inline') === 'true',`.
- In `serialize`, replace the destructure and the JSON line:

```ts
          const { src, width, height, inline } = node.attrs
          ...
          ;(state as { write: (s: string) => void }).write(
            JSON.stringify(inline ? { src, width, height, inline } : { src, width, height }),
          )
```

- In `updateDOM`, after the `data-height` line add:

```ts
                div.setAttribute('data-inline', String(data.inline === true))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/editor/extensions/inkBlockFence.test.ts src/lib/canvasNote.test.ts`
Expected: PASS. Then `npm run typecheck` — expected clean.

- [ ] **Step 5: Commit**

```bash
git add src/editor/extensions/InkBlock.ts src/editor/extensions/inkBlockFence.test.ts src/lib/canvasNote.ts src/lib/canvasNote.test.ts
git commit -m "feat(ink): inline fence flag, written by canvas notes"
```

---

### Task 2: `InkCanvas` — `onSaved`, `autoActivate`, scroll ancestor

**Files:**
- Modify: `src/ink/useInkCanvas.ts`
- Modify: `src/ink/InkCanvas.tsx`
- Test: `src/ink/inkCanvasSaved.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `useInkCanvas(svgPath, width, height, { zoom?, autoGrow?, onSaved?: () => void })` — `onSaved` fires after every sidecar write resolves, including the unmount flush.
  - `<InkCanvas ... onSaved?: () => void; autoActivate?: boolean />` — `autoActivate` registers the canvas in `useInkStore` on mount.
  - `export function scrollAncestors(from: HTMLElement, dx: number, dy: number): void` — scrolls `.ink-editor-body` on both axes if present, else the existing `.editor-scroll`/`.ink-canvas-wrap` behaviour.
  - Used by Task 3 (`InkEditorOverlay`) and Task 4 (`InkPreview`).

- [ ] **Step 1: Write the failing tests**

Create `src/ink/inkCanvasSaved.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { InkCanvas, scrollAncestors } from './InkCanvas'
import { useInkStore } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { InkData } from './types'

const write = vi.fn<(path: string, data: InkData) => Promise<void>>().mockResolvedValue(undefined)

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: () => Promise.resolve(null),
    write: (path: string, data: InkData) => write(path, data),
  },
}))

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined)
  useInkStore.setState({
    tool: 'text',
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
    textSize: 18,
    activeCanvas: null,
    activeCanvasId: null,
  })
})
afterEach(cleanup)

function tap(canvas: Element) {
  fireEvent.pointerDown(canvas, { pointerType: 'pen', pointerId: 1 })
  fireEvent.pointerUp(canvas, { pointerType: 'pen', pointerId: 1 })
}

async function openEditor(container: HTMLElement): Promise<HTMLTextAreaElement> {
  tap(container.querySelector('canvas')!)
  return waitFor(() => {
    const el = container.querySelector('textarea.ink-text-editor')
    if (!el) throw new Error('editor not open')
    return el as HTMLTextAreaElement
  })
}

describe('onSaved', () => {
  it('fires after a committed edit has been written', async () => {
    const onSaved = vi.fn()
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} onSaved={onSaved} />)
    const editor = await openEditor(container)

    fireEvent.change(editor, { target: { value: 'hello' } })
    fireEvent.blur(editor)

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('does not fire until the write has resolved', async () => {
    let resolveWrite: () => void = () => {}
    write.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveWrite = resolve }))
    const onSaved = vi.fn()
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} onSaved={onSaved} />)
    const editor = await openEditor(container)

    fireEvent.change(editor, { target: { value: 'hello' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(write).toHaveBeenCalled())
    expect(onSaved).not.toHaveBeenCalled()

    resolveWrite()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it('fires for the flush of a label still open when the canvas unmounts', async () => {
    const onSaved = vi.fn()
    const { container, unmount } = render(
      <InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} onSaved={onSaved} />,
    )
    const editor = await openEditor(container)
    fireEvent.change(editor, { target: { value: 'unfinished' } })

    unmount()

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(write.mock.calls[0]?.[1].texts[0]?.text).toBe('unfinished')
  })
})

describe('autoActivate', () => {
  it('registers the canvas on mount, without a pointer press', async () => {
    render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} autoActivate />)

    await waitFor(() => expect(useInkStore.getState().activeCanvasId).toBe('/ws/N.ink/a.svg'))
    expect(useInkStore.getState().activeCanvas).not.toBeNull()
  })

  it('stays unregistered without the flag', async () => {
    render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} />)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useInkStore.getState().activeCanvasId).toBeNull()
  })
})

describe('scrollAncestors', () => {
  function withScroll(el: HTMLElement) {
    Object.defineProperty(el, 'scrollTop', { value: 100, writable: true })
    Object.defineProperty(el, 'scrollLeft', { value: 100, writable: true })
    return el
  }

  it('pans the overlay body on both axes, opposite to the drag', () => {
    const body = withScroll(document.createElement('div'))
    body.className = 'ink-editor-body'
    const inner = document.createElement('div')
    body.appendChild(inner)

    scrollAncestors(inner, 10, 20)

    expect(body.scrollTop).toBe(80)
    expect(body.scrollLeft).toBe(90)
  })

  it('still pans the note column vertically when there is no overlay', () => {
    const page = withScroll(document.createElement('div'))
    page.className = 'editor-scroll'
    const inner = document.createElement('div')
    page.appendChild(inner)

    scrollAncestors(inner, 10, 20)

    expect(page.scrollTop).toBe(80)
    expect(page.scrollLeft).toBe(100)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ink/inkCanvasSaved.test.tsx`
Expected: FAIL — `scrollAncestors` is not exported; `onSaved`/`autoActivate` are ignored.

- [ ] **Step 3: Implement `useInkCanvas`**

In `src/ink/useInkCanvas.ts`:

1. `InkOptions` gains `onSaved?: () => void`; the signature destructures it: `{ zoom = 1, autoGrow = false, onSaved }: InkOptions = {}`.
2. Directly after the `inkDataRef` effect (before `activePen`), add:

```ts
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    onSavedRef.current = onSaved
  }, [onSaved])

  // Writes are fire-and-forget, so a caller re-reading the sidecar on close could
  // beat the last stroke to disk. `onSaved` fires from the resolved write instead.
  const save = useCallback(
    (data: InkData) => {
      void inkApi.write(svgPath, data).then(() => onSavedRef.current?.())
    },
    [svgPath],
  )
```

3. Replace each `void inkApi.write(svgPath, X)` with `save(X)`, and swap `svgPath` for `save` in the matching dependency list:
   - `commit` (`save(next)`; deps `[inkData, save]`)
   - `undo` (`save(previous)`; deps `[history, future, inkData, save]`)
   - `redo` (`save(next)`; deps `[history, future, inkData, save]`)
   - the unmount-flush effect (`save(next)`; deps `[save]`)
   - `handlePointerUp`: the text-drag write (`save(grown)`), the lasso-drag write (`save(grown)`) and the erase write (`save(inkData)`); in its dependency list replace `svgPath` with `save`.
4. Confirm nothing else still calls `inkApi.write`: `grep -n "inkApi.write" src/ink/useInkCanvas.ts` should show only the line inside `save`.

- [ ] **Step 4: Implement `InkCanvas`**

In `src/ink/InkCanvas.tsx`:

```tsx
// Dragging a finger moves the content with it, so the scroll offset goes the
// opposite way. Vertical travel belongs to the note; horizontal only matters
// once zoom has made the canvas wider than the column. The full-screen editor
// owns a scroll container that pans on both axes, so it takes precedence.
export function scrollAncestors(from: HTMLElement, dx: number, dy: number): void {
  const editor = from.closest('.ink-editor-body')
  if (editor) {
    editor.scrollTop -= dy
    editor.scrollLeft -= dx
    return
  }
  const page = from.closest('.editor-scroll')
  if (page) page.scrollTop -= dy
  const canvas = from.closest('.ink-canvas-wrap')
  if (canvas) canvas.scrollLeft -= dx
}
```

Props: add `onSaved?: () => void` and `autoActivate?: boolean`; destructure `autoActivate = false` and `onSaved`; pass `onSaved` into `useInkCanvas(..., { zoom, autoGrow, onSaved })`. After the `useEffect` that re-registers on `isActive`, add:

```tsx
  // Mount-time only: the tool group renders nothing until a canvas has
  // registered, and registration otherwise waits for a pointer press. From here
  // the effect above keeps the handle fresh.
  useEffect(() => {
    if (autoActivate) setActiveCanvas(svgPath, handle())
  }, [autoActivate, svgPath])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ink`
Expected: PASS (new file and every existing ink test). Then `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/ink/useInkCanvas.ts src/ink/InkCanvas.tsx src/ink/inkCanvasSaved.test.tsx
git commit -m "feat(ink): onSaved/autoActivate on InkCanvas, scroll the overlay body"
```

---

### Task 3: `InkEditorOverlay`

**Files:**
- Create: `src/ink/InkEditorOverlay.tsx`
- Modify: `src/index.css` (append overlay rules)
- Test: `src/ink/inkEditorOverlay.test.tsx` (create)

**Interfaces:**
- Consumes: `InkCanvas` props `onSaved`, `autoActivate`, `autoGrow`, `zoom`, `onZoomChange` (Task 2); `InkToolGroup` (existing, no props); `useInkStore.getState().activeCanvas` / `.activeCanvasId` (existing `CanvasHandle` has `undo()`/`redo()`).
- Produces: `export function InkEditorOverlay(props: { src: string; width: number; height: number; onSaved: () => void; onClose: () => void })`. Renders into `document.body` with root class `ink-editor-overlay`, body class `ink-editor-body`, Done button text `Done`. Used by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/ink/inkEditorOverlay.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react'
import { InkEditorOverlay } from './InkEditorOverlay'
import { useInkStore } from '../store/ink'
import type { CanvasHandle } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { InkData } from './types'

const write = vi.fn<(path: string, data: InkData) => Promise<void>>().mockResolvedValue(undefined)

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: () => Promise.resolve(null),
    write: (path: string, data: InkData) => write(path, data),
  },
}))

const SRC = '/ws/N.ink/a.svg'

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined)
  useInkStore.setState({
    tool: 'text',
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
    textSize: 18,
    activeCanvas: null,
    activeCanvasId: null,
  })
})
afterEach(cleanup)

function mount() {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<InkEditorOverlay src={SRC} width={700} height={400} onSaved={onSaved} onClose={onClose} />)
  const overlay = document.querySelector<HTMLElement>('.ink-editor-overlay')
  if (!overlay) throw new Error('overlay not mounted')
  return { overlay, onClose, onSaved }
}

async function openLabel(text: string): Promise<HTMLTextAreaElement> {
  const canvas = document.querySelector('canvas')!
  fireEvent.pointerDown(canvas, { pointerType: 'pen', pointerId: 1 })
  fireEvent.pointerUp(canvas, { pointerType: 'pen', pointerId: 1 })
  const editor = await waitFor(() => {
    const el = document.querySelector('textarea.ink-text-editor')
    if (!el) throw new Error('editor not open')
    return el as HTMLTextAreaElement
  })
  fireEvent.change(editor, { target: { value: text } })
  return editor
}

function spyHandle(): CanvasHandle {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    deleteSelected: vi.fn(),
    hasSelection: false,
    toggleRuler: vi.fn(),
    rulerOn: false,
    zoom: 1,
    setZoom: vi.fn(),
  }
}

describe('the full-screen ink editor', () => {
  it('renders into document.body and takes focus', () => {
    const { overlay } = mount()

    expect(overlay.parentElement).toBe(document.body)
    expect(document.activeElement).toBe(overlay)
  })

  it('shows the drawing tools straight away', async () => {
    mount()

    await screen.findByLabelText('Pen')
    expect(useInkStore.getState().activeCanvasId).toBe(SRC)
  })

  it('closes from Done', () => {
    const { onClose } = mount()

    fireEvent.click(screen.getByText('Done'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const { overlay, onClose } = mount()

    fireEvent.keyDown(overlay, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // The label editor's own Escape means "discard this label". If the overlay
  // also closed on it, one keypress would throw away the label *and* the page.
  it('does not close on the Escape that cancels a label being typed', async () => {
    const { onClose } = mount()
    const editor = await openLabel('half a thought')

    fireEvent.keyDown(editor, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('textarea.ink-text-editor')).toBeNull()
  })
})

describe('keyboard', () => {
  it('Ctrl+Z undoes the canvas and the key never reaches the page behind', async () => {
    const { overlay } = mount()
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    const editor = await openLabel('hello')
    fireEvent.blur(editor)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(overlay, { key: 'z', ctrlKey: true })

    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write.mock.calls[1]?.[1].texts).toHaveLength(0)
    expect(behind).not.toHaveBeenCalled()
    document.removeEventListener('keydown', behind)
  })

  it('Ctrl+Y and Ctrl+Shift+Z redo', async () => {
    const { overlay } = mount()
    const editor = await openLabel('hello')
    fireEvent.blur(editor)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(overlay, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))

    fireEvent.keyDown(overlay, { key: 'y', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3))
    expect(write.mock.calls[2]?.[1].texts).toHaveLength(1)

    fireEvent.keyDown(overlay, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledTimes(4))
    fireEvent.keyDown(overlay, { key: 'Z', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledTimes(5))
    expect(write.mock.calls[4]?.[1].texts).toHaveLength(1)
  })

  // Before the first stroke the slot can still belong to a canvas in the note.
  it('leaves another canvas alone when it owns the active slot', async () => {
    const { overlay } = mount()
    await waitFor(() => expect(useInkStore.getState().activeCanvasId).toBe(SRC))
    const other = spyHandle()
    useInkStore.getState().setActiveCanvas('/ws/N.ink/other.svg', other)

    fireEvent.keyDown(overlay, { key: 'z', ctrlKey: true })

    expect(other.undo).not.toHaveBeenCalled()
  })

  it('leaves Ctrl+Z inside the label editor to the textarea', async () => {
    mount()
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    const editor = await openLabel('hello')

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })

    expect(write).not.toHaveBeenCalled()
    expect(behind).not.toHaveBeenCalled()
    document.removeEventListener('keydown', behind)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ink/inkEditorOverlay.test.tsx`
Expected: FAIL — `./InkEditorOverlay` does not exist.

- [ ] **Step 3: Implement the overlay**

Create `src/ink/InkEditorOverlay.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { InkCanvas } from './InkCanvas'
import { InkToolGroup } from '../editor/toolbar/InkToolGroup'
import { useInkStore } from '../store/ink'

interface InkEditorOverlayProps {
  src: string
  width: number
  height: number
  onSaved: () => void
  onClose: () => void
}

export function InkEditorOverlay({ src, width, height, onSaved, onClose }: InkEditorOverlayProps) {
  const [zoom, setZoom] = useState(1)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  // The note editor stays mounted behind this, so undo has to be answered here:
  // left alone it would silently edit the note under the drawing.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const key = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
      e.stopPropagation()
      // A label being typed keeps the textarea's own undo.
      if (e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      const { activeCanvas, activeCanvasId } = useInkStore.getState()
      if (!activeCanvas || activeCanvasId !== src) return
      if (key === 'y' || e.shiftKey) activeCanvas.redo()
      else activeCanvas.undo()
      return
    }
    // The label editor preventDefaults the Escape that cancels a label, so by the
    // time it bubbles here `defaultPrevented` means "already handled".
    if (e.key === 'Escape' && !e.defaultPrevented) onClose()
  }

  return createPortal(
    <div
      ref={rootRef}
      className="ink-editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Drawing editor"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="ink-editor-header">
        <InkToolGroup />
        <button type="button" className="dialog-action-primary ink-editor-done" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="ink-editor-body">
        <InkCanvas
          svgPath={src}
          width={width}
          height={height}
          zoom={zoom}
          onZoomChange={setZoom}
          autoGrow
          autoActivate
          onSaved={onSaved}
        />
      </div>
    </div>,
    document.body,
  )
}
```

Append to `src/index.css` (end of file):

```css
.ink-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--bg-sunken);
  outline: none;
}

.ink-editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.ink-editor-header .toolbar-ink {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.ink-editor-done { flex: none; }

/* Anchored top-left on purpose, not centred: the page can then grow right and
   down without the content shifting under the pen. */
.ink-editor-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-lg);
}

.ink-editor-body .ink-canvas-wrap {
  overflow: visible;
  width: max-content;
}
```

The overlay is a full-window surface rather than a floating one, so it is deliberately **not** added to the `surface-in` selector list (`DiagramEditorOverlay` isn't either).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ink`
Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/ink/InkEditorOverlay.tsx src/ink/inkEditorOverlay.test.tsx src/index.css
git commit -m "feat(ink): full-screen InkEditorOverlay"
```

---

### Task 4: `InkBlock` view — inline canvas vs preview

**Files:**
- Create: `src/editor/extensions/InkBlockView.tsx`
- Create: `src/editor/extensions/InkPreview.tsx`
- Modify: `src/editor/extensions/InkBlock.ts` (drop the in-file view, import `InkBlockView`)
- Modify: `src/index.css` (preview rules)
- Test: `src/editor/extensions/inkBlockMount.test.tsx` (modify)

**Interfaces:**
- Consumes: `node.attrs.inline` (Task 1); `InkEditorOverlay` props (Task 3); `inkApi.read(path): Promise<InkData | null>` and `inkDataToSvg(data: InkData): string` (existing); `sanitizeNoteHtml` (existing).
- Produces: `InkBlockView` (a `ReactNodeViewProps` component); `InkPreview({ src, editable })` which listens for `window` event `ink:auto-open` with `detail: { src: string }` — Task 5 dispatches it.

- [ ] **Step 1: Write the failing tests**

Replace `src/editor/extensions/inkBlockMount.test.tsx` with:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'
import { useInkStore } from '../../store/ink'
import { DEFAULT_PENS } from '../../ink/pens'
import type { InkData } from '../../ink/types'

const read = vi.fn<(path: string) => Promise<InkData | null>>()
const write = vi.fn<(path: string, data: InkData) => Promise<void>>()

vi.mock('../../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: (path: string) => read(path),
    write: (path: string, data: InkData) => write(path, data),
  },
}))

const SRC = '/ws/N.ink/a.svg'
const EMPTY: InkData = { width: 700, height: 400, strokes: [], shapes: [], texts: [] }
const WITH_LINE: InkData = {
  ...EMPTY,
  shapes: [{ id: 's1', kind: 'line', x1: 10, y1: 10, x2: 200, y2: 120, color: '#000000', size: 2 }],
}
const PREVIEW_FENCE = '```ink\n{"src":"/ws/N.ink/a.svg","width":700,"height":400}\n```'
const INLINE_FENCE = '```ink\n{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":true}\n```'

let editor: Editor | null = null

function TestEditor({ content, editable = true }: { content: string; editable?: boolean }) {
  const instance = useEditor({ extensions: coreExtensions, content, editable })
  useEffect(() => {
    if (instance) editor = instance
  }, [instance])
  return <EditorContent editor={instance} />
}

beforeEach(() => {
  read.mockReset().mockResolvedValue(EMPTY)
  write.mockReset().mockResolvedValue(undefined)
  useInkStore.setState({
    tool: 'text',
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
    textSize: 18,
    activeCanvas: null,
    activeCanvasId: null,
  })
})

afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
})

const overlay = () => document.querySelector('.ink-editor-overlay')

async function previewOf(container: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const el = container.querySelector<HTMLElement>('.ink-preview')
    if (!el) throw new Error('preview not mounted')
    return el
  })
}

async function typeLabel(text: string): Promise<HTMLTextAreaElement> {
  const canvas = document.querySelector('canvas')!
  fireEvent.pointerDown(canvas, { pointerType: 'pen', pointerId: 1 })
  fireEvent.pointerUp(canvas, { pointerType: 'pen', pointerId: 1 })
  const textarea = await waitFor(() => {
    const el = document.querySelector('textarea.ink-text-editor')
    if (!el) throw new Error('editor not open')
    return el as HTMLTextAreaElement
  })
  fireEvent.change(textarea, { target: { value: text } })
  return textarea
}

// A React node view has to render a NodeViewWrapper; ReactNodeViewRenderer
// throws "Please use the NodeViewWrapper component for your node view" from
// its own `get dom()` otherwise. InkCanvas puts a plain <div class="ink-canvas-wrap">
// at its root — so mounting one throws, and that is what Split Into Tasks hit
// the moment it started creating ink blocks for every solution.
describe('mounting an ink block in a real React editor', () => {
  it('renders an inline block without throwing', async () => {
    const { container } = render(<TestEditor content={INLINE_FENCE} />)

    await waitFor(() => expect(editor).not.toBeNull())
    // The precise thing that was missing: ReactNodeViewRenderer looks this
    // attribute up to find the node's DOM, and throws without it.
    await waitFor(() => expect(container.querySelector('[data-node-view-wrapper]')).not.toBeNull())
    expect(container.querySelector('.ink-canvas-wrap')).not.toBeNull()
    expect(container.querySelector('.ink-preview')).toBeNull()
  })

  it('renders a block without the flag as a preview, not a canvas', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)

    await previewOf(container)
    expect(container.querySelector('.ink-canvas-wrap')).toBeNull()
    expect(overlay()).toBeNull()
  })

  it('shows a placeholder for an empty drawing', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)

    await previewOf(container)
    await screen.findByText('Empty drawing — click to draw')
  })

  it('shows a placeholder, not an error, when the sidecar cannot be read', async () => {
    read.mockResolvedValue(null)
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)

    await previewOf(container)
    await screen.findByText('Empty drawing — click to draw')
  })

  it('renders the whole page as a sanitized SVG once there is ink', async () => {
    read.mockResolvedValue(WITH_LINE)
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)

    await waitFor(() => expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull())
    expect(container.querySelector('.ink-preview-empty')).toBeNull()
  })
})

describe('opening the full-screen editor', () => {
  it('opens from a click on the preview, and closes from Done', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))

    await waitFor(() => expect(overlay()).not.toBeNull())
    fireEvent.click(screen.getByText('Done'))

    await waitFor(() => expect(overlay()).toBeNull())
    expect(container.querySelector('.ink-preview')).not.toBeNull()
  })

  it('opens from the Edit button', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    await previewOf(container)

    fireEvent.click(screen.getByLabelText('Edit drawing'))

    await waitFor(() => expect(overlay()).not.toBeNull())
  })

  it('closes on Escape, but not on the Escape that cancels a label', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())

    const textarea = await typeLabel('half')
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(overlay()).not.toBeNull()

    fireEvent.keyDown(overlay()!, { key: 'Escape' })
    await waitFor(() => expect(overlay()).toBeNull())
  })

  it('keeps the block and sidecar when closed without drawing', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())

    fireEvent.click(screen.getByText('Done'))

    await waitFor(() => expect(overlay()).toBeNull())
    expect(write).not.toHaveBeenCalled()
    expect(container.querySelector('.ink-preview')).not.toBeNull()
  })

  it('opens when ink:auto-open names this block, and ignores other blocks', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    await previewOf(container)

    window.dispatchEvent(new CustomEvent('ink:auto-open', { detail: { src: '/ws/N.ink/other.svg' } }))
    expect(overlay()).toBeNull()

    window.dispatchEvent(new CustomEvent('ink:auto-open', { detail: { src: SRC } }))
    await waitFor(() => expect(overlay()).not.toBeNull())
  })
})

// Review Focus 5: a read-only note shows its drawings but cannot edit them.
describe('a note that is not editable', () => {
  it('has no Edit button and ignores clicks and auto-open', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} editable={false} />)
    const preview = await previewOf(container)

    expect(screen.queryByLabelText('Edit drawing')).toBeNull()
    fireEvent.click(preview)
    window.dispatchEvent(new CustomEvent('ink:auto-open', { detail: { src: SRC } }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(overlay()).toBeNull()
  })
})

describe('keeping the preview current', () => {
  it('re-reads the sidecar when the overlay reports a save', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())
    read.mockResolvedValue(WITH_LINE)

    const textarea = await typeLabel('hello')
    fireEvent.blur(textarea)

    await waitFor(() => expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull())
  })

  // Review Focus 3: Done pressed while a label is still open. The text is saved
  // by useInkCanvas's unmount flush, which lands *after* the overlay is gone.
  it('refreshes when the write from a label left open on Done resolves', async () => {
    let resolveWrite: () => void = () => {}
    write.mockImplementation(() => new Promise<void>((resolve) => { resolveWrite = resolve }))
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())
    await typeLabel('unfinished')

    fireEvent.click(screen.getByText('Done'))
    await waitFor(() => expect(overlay()).toBeNull())
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const readsBeforeWrite = read.mock.calls.length
    read.mockResolvedValue(WITH_LINE)

    resolveWrite()

    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(readsBeforeWrite))
    await waitFor(() => expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull())
  })

  // Review Focus 4: a slow early read must not overwrite a newer one.
  it('keeps the newest data when reads resolve out of order', async () => {
    let resolveFirst: (data: InkData | null) => void = () => {}
    read.mockReset()
    read.mockImplementationOnce(() => new Promise<InkData | null>((resolve) => { resolveFirst = resolve }))
    read.mockResolvedValue(WITH_LINE)
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())

    const textarea = await typeLabel('hello')
    fireEvent.blur(textarea)
    await waitFor(() => expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull())

    resolveFirst(EMPTY)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull()
    expect(container.querySelector('.ink-preview-empty')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/editor/extensions/inkBlockMount.test.tsx`
Expected: FAIL — every block still renders an inline `InkCanvas`; `.ink-preview` never appears.

- [ ] **Step 3: Implement `InkPreview`**

Create `src/editor/extensions/InkPreview.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { InkEditorOverlay } from '../../ink/InkEditorOverlay'
import { inkDataToSvg } from '../../ink/svgSerialiser'
import { inkApi } from '../../lib/ink'
import { sanitizeNoteHtml } from '../../lib/sanitizeHtml'
import type { InkData } from '../../ink/types'

const PREVIEW_MAX_HEIGHT = 320

interface InkPreviewProps {
  src: string
  width: number
  height: number
  editable: boolean
}

function isEmpty(data: InkData | null): boolean {
  return !data || data.strokes.length + data.shapes.length + data.texts.length === 0
}

export function InkPreview({ src, width, height, editable }: InkPreviewProps) {
  const [data, setData] = useState<InkData | null>(null)
  const [editing, setEditing] = useState(false)
  const latestRead = useRef(0)

  // Reads can resolve out of order when saves land close together, so only the
  // newest request is allowed to write the result.
  const refresh = useCallback(() => {
    const id = ++latestRead.current
    void inkApi.read(src).then((next) => {
      if (id === latestRead.current) setData(next)
    })
  }, [src])

  useEffect(() => {
    refresh()
  }, [refresh])

  // insertInk dispatches this right after inserting a brand-new, empty drawing —
  // there is nothing to preview yet, so go straight to drawing. Matched on src so
  // only the block that was just inserted opens.
  useEffect(() => {
    if (!editable) return
    function onAutoOpen(event: Event) {
      if ((event as CustomEvent<{ src: string }>).detail.src === src) setEditing(true)
    }
    window.addEventListener('ink:auto-open', onAutoOpen)
    return () => window.removeEventListener('ink:auto-open', onAutoOpen)
  }, [src, editable])

  const open = editable ? () => setEditing(true) : undefined
  // The page's own size, not the node's: the page grows as you write, and the
  // node attrs keep the size it was inserted with.
  const pageWidth = data?.width ?? width
  const pageHeight = data?.height ?? height
  const scale = Math.min(1, PREVIEW_MAX_HEIGHT / pageHeight)

  return (
    <>
      <div className={`ink-preview${editable ? ' editable' : ''}`} onClick={open}>
        {isEmpty(data) ? (
          <div className="ink-preview-empty">Empty drawing — click to draw</div>
        ) : (
          <div
            className="ink-preview-page"
            style={{ width: pageWidth * scale, aspectRatio: `${pageWidth} / ${pageHeight}` }}
            // The sidecar is a file in a workspace that can be shared or synced — the
            // same trust boundary as a note's own .md, so it gets the same sanitizing
            // pass DiagramBlock gives its SVG.
            dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(inkDataToSvg(data as InkData)) }}
          />
        )}
        {editable && (
          <button type="button" className="diagram-block-edit ink-preview-edit" aria-label="Edit drawing" onClick={open}>
            Edit
          </button>
        )}
      </div>
      {editing && (
        <InkEditorOverlay
          src={src}
          width={width}
          height={height}
          onSaved={refresh}
          onClose={() => {
            setEditing(false)
            refresh()
          }}
        />
      )}
    </>
  )
}
```

The `data as InkData` cast is safe: the `isEmpty` branch above already excluded `null`. If you prefer no cast, restructure as `data && !isEmpty(data) ? … : placeholder`.

- [ ] **Step 4: Implement `InkBlockView` and slim `InkBlock.ts`**

Create `src/editor/extensions/InkBlockView.tsx` (the comment on `NodeViewWrapper` moves here with the component):

```tsx
import { useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { InkCanvas } from '../../ink/InkCanvas'
import { InkPreview } from './InkPreview'

interface InkBlockAttrs {
  src: string
  width: number
  height: number
  inline: boolean
}

// Every React node view has to render a `NodeViewWrapper` at its root:
// `ReactNodeViewRenderer` reads the wrapper's element out of the rendered
// output and throws "Please use the NodeViewWrapper component for your node
// view" from its own `get dom()` without one. That throw escapes
// `EditorView.updateState`, so it does not merely break the block — it aborts
// whatever transaction created it, which is how one bad ink block could take
// a whole "Split Into Tasks" rewrite down with it.
export function InkBlockView({ node, editor }: ReactNodeViewProps) {
  // Zoom is per block and lives only in the view — the file keeps unscaled
  // coordinates, so reopening a note never inherits someone's zoom level.
  const [zoom, setZoom] = useState(1)
  const { src, width, height, inline } = node.attrs as unknown as InkBlockAttrs
  // A wrapper even with nothing in it — returning null renders no wrapper.
  if (!src) return <NodeViewWrapper className="ink-block" />
  return (
    <NodeViewWrapper className="ink-block">
      {inline ? (
        <InkCanvas
          svgPath={src}
          width={width}
          height={height}
          zoom={zoom}
          onZoomChange={setZoom}
          autoGrow
        />
      ) : (
        <InkPreview src={src} width={width} height={height} editable={editor.isEditable} />
      )}
    </NodeViewWrapper>
  )
}
```

In `src/editor/extensions/InkBlock.ts`: delete the local `InkBlockView` function and its comment, delete the now-unused imports (`createElement`, `useState`, `NodeViewWrapper`, `ReactNodeViewProps`, `InkCanvas`), keep `ReactNodeViewRenderer`, and add `import { InkBlockView } from './InkBlockView'`. `addNodeView()` is unchanged (`return ReactNodeViewRenderer(InkBlockView)`). Keep the `InkBlockAttrs` interface there (the markdown serializer uses it).

- [ ] **Step 5: Add the preview styles**

Append to `src/index.css`:

```css
.ink-block {
  display: block;
  margin: var(--space-md) 0;
  max-width: 100%;
}

.ink-preview {
  position: relative;
  display: inline-block;
  max-width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-raised);
  overflow: hidden;
}

.ink-preview.editable { cursor: pointer; }

.ink-preview-page { max-width: 100%; }

.ink-preview-page svg {
  display: block;
  width: 100%;
  height: 100%;
}

.ink-preview-empty {
  padding: 40px 24px;
  color: var(--text-tertiary);
  font: var(--text-empty-state);
}

/* Look comes from .diagram-block-edit; this only places it and fades it in. */
.ink-preview-edit {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-standard);
}

.ink-preview:hover .ink-preview-edit,
.ink-preview-edit:focus-visible {
  opacity: 1;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/editor src/ink src/lib`
Expected: PASS. `splitIntoTasks.test.ts`, `inkCanvasActivation.test.tsx` and `insertGroup.test.tsx` must still pass — `inkCanvasActivation.test.tsx` mounts a real `NoteEditor` with an unflagged fence and expects a `<canvas>`; **update it to use the inline fence** (`'```ink\n{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":true}\n```'`) because an unflagged block is now a preview. Then `npm run typecheck`.

- [ ] **Step 7: Check the styling by eye**

Run `npm run dev`, open the `ui-preview` skill's workflow, and screenshot a preview block (empty and with ink) beside an inline canvas note, and the overlay header with the tool group. Compare spacing and the Edit button against a `.diagram-block` (CLAUDE.md "UI spacing gaps": verify against a reference element, not by className existence). Fix any unstyled class found.

- [ ] **Step 8: Commit**

```bash
git add src/editor/extensions/InkBlockView.tsx src/editor/extensions/InkPreview.tsx src/editor/extensions/InkBlock.ts src/editor/extensions/inkBlockMount.test.tsx src/editor/inkCanvasActivation.test.tsx src/index.css
git commit -m "feat(ink): ink blocks render as a preview that opens the full-screen editor"
```

---

### Task 5: Open the editor on insert

**Files:**
- Modify: `src/editor/toolbar/insertInk.ts`
- Modify: `src/editor/extensions/SlashCommands.tsx`
- Test: `src/editor/toolbar/insertInk.test.ts` (create)

**Interfaces:**
- Consumes: `InkPreview`'s `ink:auto-open` listener, `detail: { src: string }` (Task 4).
- Produces: `insertInk(editor, notePath)` dispatches `window` `CustomEvent('ink:auto-open', { detail: { src: svgPath } })` after the node is inserted. Both the toolbar button, the native menu and the slash command now go through it.

- [ ] **Step 1: Write the failing test**

Create `src/editor/toolbar/insertInk.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from '../extensions'
import { insertInk } from './insertInk'

vi.mock('../../lib/ink', () => ({
  inkApi: { ensureDir: () => Promise.resolve('/ws/N.ink'), write: () => Promise.resolve() },
}))

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('insertInk', () => {
  it('inserts a block and asks that block to open its editor', async () => {
    editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content: '<p></p>' })
    const seen: string[] = []
    const listener = (e: Event) => seen.push((e as CustomEvent<{ src: string }>).detail.src)
    window.addEventListener('ink:auto-open', listener)

    await insertInk(editor, '/ws/N.md')
    window.removeEventListener('ink:auto-open', listener)

    const srcs: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'inkBlock') srcs.push(node.attrs.src as string)
      return true
    })
    expect(srcs).toHaveLength(1)
    expect(seen).toEqual(srcs)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/toolbar/insertInk.test.ts`
Expected: FAIL — `seen` is empty.

- [ ] **Step 3: Implement**

`src/editor/toolbar/insertInk.ts` — after the `insertContent` call add:

```ts
  // A brand-new drawing has nothing to preview — open straight into the editor.
  window.dispatchEvent(new CustomEvent('ink:auto-open', { detail: { src: svgPath } }))
```

`src/editor/extensions/SlashCommands.tsx` — replace the whole `run` of the `'Ink Block'` entry with:

```ts
    run: ({ editor, range }) => {
      const notePath = editor.storage.noteContext.notePath
      if (!notePath) return
      editor.chain().focus().deleteRange(range).run()
      void insertInk(editor, notePath).catch(report)
    },
```

then delete the now-unused `import { inkApi } from '../../lib/ink'`, `import type { InkData } from '../../ink/types'`, and the three constants `INK_WIDTH`, `INK_HEIGHT`, `EMPTY_INK` (lines ~8–18; first `grep -n "inkApi\|InkData\|INK_WIDTH\|INK_HEIGHT\|EMPTY_INK" src/editor/extensions/SlashCommands.tsx` to confirm nothing else uses them). Add `import { insertInk } from '../toolbar/insertInk'` and `import { report } from '../splitIntoTasks'` (the same `report` import `InsertGroup.tsx` uses).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/editor`
Expected: PASS (including `htmlFeatures.test.ts`, which references the slash commands). Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/editor/toolbar/insertInk.ts src/editor/toolbar/insertInk.test.ts src/editor/extensions/SlashCommands.tsx
git commit -m "feat(ink): inserting a canvas opens the full-screen editor"
```

---

### Task 6: End-to-end verification

**Files:**
- Create: `e2e/specs/ink-fullscreen-editor.e2e.ts`

**Interfaces:**
- Consumes: everything above, through the real compiled app. Read `.claude/skills/e2e-verify/SKILL.md` first — click via in-page JS, assert on disk, screenshot visual states, never blind-sleep.
- Produces: one spec, no code consumed elsewhere.

- [ ] **Step 1: Write the spec**

Create `e2e/specs/ink-fullscreen-editor.e2e.ts`:

```ts
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
}

async function waitForSelector(selector: string, timeoutMsg: string): Promise<void> {
  await browser.waitUntil(
    async () => browser.execute((sel) => !!document.querySelector(sel), selector),
    { timeout: 10000, timeoutMsg },
  )
}

async function focusEditorEnd(): Promise<void> {
  await browser.execute(() => {
    const el = document.querySelector('.ProseMirror')
    if (!(el instanceof HTMLElement)) throw new Error('no element matching .ProseMirror')
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
}

async function createNote(title: string): Promise<string> {
  const notePath = join(fixtureWorkspace, `${title}.md`)
  rmSync(notePath, { force: true })
  await clickInPage('.sidebar-new-actions button')
  await fillPromptDialog(title)
  await focusEditorEnd()
  await browser.keys(['End', 'Enter'])
  return notePath
}

// The pen is the only thing that draws (touch pans), so the stroke has to be a
// pen PointerEvent. A zigzag, not a line: a near-straight stroke is converted
// to a line shape by the auto-straighten.
async function drawZigzag(): Promise<void> {
  await browser.execute(() => {
    const canvas = document.querySelector('.ink-editor-overlay canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no overlay canvas')
    const rect = canvas.getBoundingClientRect()
    const fire = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerType: 'pen',
          pointerId: 7,
          pressure: 0.5,
          bubbles: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: rect.left + x,
          clientY: rect.top + y,
        }),
      )
    fire('pointerdown', 40, 40)
    for (let i = 1; i <= 20; i++) fire('pointermove', 40 + i * 15, 40 + (i % 2 ? 60 : 0))
    fire('pointerup', 340, 40)
  })
}

describe('full-screen ink editor', () => {
  it('opens on insert, saves what is drawn, and previews it after Done', async () => {
    const notePath = await createNote('Ink Fullscreen')

    await browser.keys('/')
    await browser.keys('Ink')
    await waitForSelector('.slash-menu-item', 'slash menu never opened')
    await browser.execute(() => {
      const item = Array.from(document.querySelectorAll('.slash-menu-item')).find(
        (el) => el.querySelector('.slash-item-title')?.textContent === 'Ink Block',
      )
      if (!(item instanceof HTMLElement)) throw new Error('no Ink Block slash item')
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })

    await waitForSelector('.ink-editor-overlay', 'overlay never opened after insert')
    await waitForSelector('.ink-editor-header .toolbar-ink', 'drawing tools missing in the overlay header')
    await screenshot('ink-fullscreen-open')

    await drawZigzag()
    await clickInPage('.ink-editor-done')
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('.ink-editor-overlay')),
      { timeout: 5000, timeoutMsg: 'overlay never closed' },
    )

    await waitForSelector('.ink-preview-page svg path', 'preview never showed the stroke')
    expect(await browser.execute(() => !!document.querySelector('.ink-canvas-wrap'))).toBe(false)
    await screenshot('ink-fullscreen-preview')

    await browser.waitUntil(() => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('```ink'), {
      timeout: 10000,
      interval: 300,
      timeoutMsg: 'note never saved the ink block',
    })
    expect(readFileSync(notePath, 'utf-8')).not.toContain('"inline"')
  })

  it('re-opens from the preview', async () => {
    await waitForSelector('.ink-preview', 'preview missing — depends on the previous test')
    await clickInPage('.ink-preview')
    await waitForSelector('.ink-editor-overlay', 'click on the preview did not open the editor')
    await browser.keys('Escape')
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('.ink-editor-overlay')),
      { timeout: 5000, timeoutMsg: 'Escape did not close the overlay' },
    )
  })

  it('keeps a canvas note inline', async () => {
    await browser.execute(() => {
      const button = Array.from(document.querySelectorAll('.sidebar button')).find((el) =>
        el.textContent?.includes('Canvas'),
      )
      if (!(button instanceof HTMLElement)) throw new Error('no Canvas button in the sidebar')
      button.click()
    })
    await fillPromptDialog('Ink Canvas Note')

    await waitForSelector('.ink-canvas-wrap', 'canvas note did not open inline')
    expect(await browser.execute(() => !!document.querySelector('.ink-preview'))).toBe(false)
    expect(await browser.execute(() => !!document.querySelector('.ink-editor-overlay'))).toBe(false)

    const notePath = join(fixtureWorkspace, 'Ink Canvas Note.md')
    await browser.waitUntil(() => existsSync(notePath), { timeout: 10000, timeoutMsg: 'canvas note never created' })
    expect(readFileSync(notePath, 'utf-8')).toContain('"inline":true')
    expect(readdirSync(fixtureWorkspace).some((name) => name === 'Ink Canvas Note.ink')).toBe(true)
    await screenshot('ink-fullscreen-canvas-note-inline')
  })
})
```

Check against the spec while writing: the `.sidebar` Canvas-button selector and `.slash-item-title` come from `Sidebar.tsx` and the existing `p6-academic-blocks.e2e.ts`; if `.sidebar button` does not match, find the real container class in `Sidebar.tsx` around line 132.

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- --spec e2e/specs/ink-fullscreen-editor.e2e.ts`
Expected: PASS. Failure modes worth knowing:
- `overlay never opened after insert` → `ink:auto-open` fired before the node view mounted its listener (`DiagramBlock` shares this timing risk). If it reproduces consistently, replace the event with a module-level `Set<string>` of pending sources that `InkPreview` checks on mount, and add a test for it.
- `preview never showed the stroke` → synthetic `PointerEvent`s did not get `offsetX`; fall back to dispatching on the canvas's parent with explicit coordinates, or assert on the sidecar file in the note's `.ink` folder instead.

- [ ] **Step 3: Look at the screenshots**

Run: `start e2e\.artifacts` and open the three PNGs for the user to review — the overlay header (tool group + Done aligned, nothing unstyled), the preview (border, Edit button on hover, scale), the inline canvas note. Do not Read them into the conversation unless asked.

- [ ] **Step 4: Full verification**

Run, and read the output of each before claiming anything passes:

```bash
npm run typecheck
npm test
```

Expected: both clean. Then commit the spec:

```bash
git add e2e/specs/ink-fullscreen-editor.e2e.ts
git commit -m "test(e2e): full-screen ink editor"
```

---

## Self-Review

**Spec coverage**
- `InkEditorOverlay` portal, Done/Esc, zoom owned by overlay, never resizes the stored page, top-left anchor + neutral background + overlay scroll container → Task 3 (+ CSS). `scrollAncestors` nearest-ancestor → Task 2.
- Reuses `InkToolGroup` in the overlay header → Task 3; empty-header gap closed by `autoActivate` → Task 2.
- Keyboard (focus on open, Ctrl+Z/Shift+Z/Y, no leak, Esc `defaultPrevented`) → Task 3.
- Session state resets on every open (canvas unmounts) → inherent in `editing &&` mount in Task 4; nothing to build.
- `InkBlock` `inline` attr, preview vs inline, sanitize, 320px scale uncropped, placeholder, keep block when closed empty, `isEditable` gating, `onSaved` + refresh on close → Tasks 1, 2, 4.
- `insertInk` → `ink:auto-open` → Task 5 (plus the slash command copy, noted as a deviation).
- Canvas notes: `inline: true`, parser default, serializer only when true, existing canvas notes become previews (accepted, no code), solution-ink / `splitIntoTasks` unflagged → Tasks 1, 4.
- Styling reuses `.diagram-editor-*`: the spec says to reuse the diagram shell classes. This plan instead writes small dedicated `.ink-editor-*` rules, because the diagram shell is a centred, inset, rounded modal and the spec's own requirement is a full-window variant with no inset padding — `.dialog-action-primary` and `.diagram-block-edit` are reused where the look is identical.
- Testing list: mount tests, overlay keyboard, fence round-trip, `canvasNote.test.ts`, e2e, typecheck/test → Tasks 1–6.

**Placeholder scan:** none of "TBD/TODO/similar to Task N/add appropriate handling"; every code step carries code. The two spots that say "confirm with grep" (SlashCommands unused imports, sidebar selector) give the exact grep and the expected result.

**Type consistency:** `onSaved: () => void` (Tasks 2, 3, 4); `autoActivate?: boolean` (Tasks 2, 3); `InkEditorOverlay` props `{ src, width, height, onSaved, onClose }` (Tasks 3, 4); `ink:auto-open` `detail: { src: string }` (Tasks 4, 5); `scrollAncestors` / `.ink-editor-body` (Tasks 2, 3); class names `ink-editor-overlay`, `ink-editor-body`, `ink-editor-done`, `ink-preview`, `ink-preview-page`, `ink-preview-empty`, `ink-preview-edit` identical across tests, components and CSS.
