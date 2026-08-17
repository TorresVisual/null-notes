import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { EditorToolbar } from './EditorToolbar'
import { NoteEditor } from '../NoteEditor'
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

// `setActiveCanvas`/`clearActiveCanvas` are keyed on the registering canvas's
// id (Task 3's exclusivity fix), so tests reset the slot directly rather than
// through a setter that would otherwise need a matching id to take effect.
beforeEach(() => useInkStore.setState({ activeCanvas: null, activeCanvasId: null }))
afterEach(cleanup)

describe('the editor toolbar', () => {
  it('shows no drawing tools when no canvas is active', () => {
    const { queryByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    expect(queryByLabelText('Pen')).toBeNull()
  })

  it('shows the drawing tools once a canvas is active', () => {
    useInkStore.getState().setActiveCanvas('a', handle())
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    expect(getByLabelText('Pen')).toBeInTheDocument()
    expect(getByLabelText('Eraser')).toBeInTheDocument()
  })

  it('undo acts on the active canvas', () => {
    const undo = vi.fn()
    useInkStore.getState().setActiveCanvas('a', handle({ canUndo: true, undo }))
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    fireEvent.click(getByLabelText('Undo'))

    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('disables undo when the active canvas has nothing to undo', () => {
    useInkStore.getState().setActiveCanvas('a', handle({ canUndo: false }))
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    expect(getByLabelText('Undo')).toBeDisabled()
  })

  // The load-bearing rule, at the unit level. `fireEvent.mouseDown` returns
  // the boolean result of the underlying `dispatchEvent` call, which is
  // `false` exactly when some handler called `preventDefault()` on that
  // event — so this is a direct check that the bar's guard actually ran, not
  // just that nothing happened to clear the canvas. The distinction matters:
  // jsdom does not implement the browser's own "mousedown focuses/deselects"
  // default action at all (verified separately), so a plain
  // `activeCanvas is still set` assertion here would pass identically with
  // the `onMouseDown` handler deleted — jsdom never performs that default
  // action in the first place, prevented or not.
  it('prevents the default action on every press, so a click can never move focus off the canvas', () => {
    useInkStore.getState().setActiveCanvas('a', handle({ canUndo: true }))
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    const notCancelled = fireEvent.mouseDown(getByLabelText('Undo'))

    expect(notCancelled).toBe(false)
    expect(useInkStore.getState().activeCanvas).not.toBeNull()
  })

  // The mirror of the rule above: the guard is scoped to buttons, not the
  // whole bar, because the pen-size slider's thumb only drags — and a
  // <select>'s dropdown only opens — on an un-prevented mousedown. A
  // `preventDefault` back on the root `<div>` would pass every test above
  // while silently breaking this one.
  it('does not prevent the default action on an ink slider, so it can still be dragged', () => {
    useInkStore.getState().setActiveCanvas('a', handle({ canUndo: true }))
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    const notCancelled = fireEvent.mouseDown(getByLabelText('Pen size'))

    expect(notCancelled).toBe(true)
  })

  it('selecting a tool changes the shared tool', () => {
    useInkStore.getState().setActiveCanvas('a', handle())
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    fireEvent.click(getByLabelText('Eraser'))

    expect(useInkStore.getState().tool).toBe('eraser')
  })

  function editorRoot(container: HTMLElement): HTMLElement {
    const el = container.querySelector('.ProseMirror')
    if (!el) throw new Error('editor not mounted')
    return el as HTMLElement
  }

  // Places a real DOM selection inside the mounted editor and tells
  // ProseMirror about it the way a real browser would: PM does not hit-test
  // clicks itself, it reads `document.getSelection()` after the fact via its
  // own `selectionchange` listener — jsdom fires neither the hit-test nor the
  // event on its own, so both are done by hand.
  function clickInto(pmEl: HTMLElement): void {
    // ProseMirror ignores a `selectionchange` it did not cause itself unless
    // the view actually has DOM focus — `fireEvent.focus` alone only raises
    // the event, it does not move `document.activeElement`.
    pmEl.focus()
    const walker = document.createTreeWalker(pmEl, NodeFilter.SHOW_TEXT)
    const textNode = walker.nextNode()
    if (!textNode) throw new Error('no text node to place the caret in')
    const range = document.createRange()
    range.setStart(textNode, 1)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }

  // The rule the design spec requires and no other task provides: reaching a
  // caret into prose is what tells the bar "the pen is no longer in hand".
  // Wired through `NoteEditor` rather than a bare `Editor` instance — the
  // handler under test lives on the specific editor `NoteEditor` builds and
  // subscribes to, so only a real mount actually exercises it.
  it('clears the active canvas when the caret moves into text', async () => {
    useInkStore.getState().setActiveCanvas('a', handle())
    const { container } = render(
      <NoteEditor
        content="hello world"
        notePath="/ws/a.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
      />,
    )
    const pmEl = editorRoot(container)
    await waitFor(() => expect(pmEl.textContent).toContain('hello world'))

    clickInto(pmEl)

    await waitFor(() => expect(useInkStore.getState().activeCanvas).toBeNull())
  })

  // The end-to-end version of the load-bearing rule: reproduces the actual
  // shape of the bug (real prose selection already exists from earlier
  // editing, then a canvas is drawn on, then a toolbar button is pressed)
  // through the full tree `NoteEditor` really renders — `EditorToolbar` and
  // `InkToolGroup` mounted for real, not in isolation, and the same editor
  // instance `NoteEditor`'s own `selectionUpdate` handler is subscribed to.
  // `EditorToolbar` in isolation (the test above) cannot exercise that
  // handler at all, since it never mounts an editor.
  it('a real toolbar press does not trigger the caret-moved-into-text clear', async () => {
    const { container } = render(
      <NoteEditor
        content="hello world"
        notePath="/ws/a.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
      />,
    )
    const pmEl = editorRoot(container)
    await waitFor(() => expect(pmEl.textContent).toContain('hello world'))

    // Establishes a genuine, focused ProseMirror selection first — the state
    // the editor would actually be in after the user had been typing, before
    // reaching for the pen.
    clickInto(pmEl)

    act(() => useInkStore.getState().setActiveCanvas('a', handle({ canUndo: true })))
    await waitFor(() => expect(container.querySelector('[aria-label="Undo"]')).not.toBeNull())

    const undoButton = container.querySelector('[aria-label="Undo"]') as HTMLElement
    const notCancelled = fireEvent.mouseDown(undoButton)

    expect(notCancelled).toBe(false)
    expect(useInkStore.getState().activeCanvas).not.toBeNull()
  })

  // The concrete failure the whole-branch review found: `setCodeBlock()`
  // wraps the current selection in a code block without moving it, so
  // `selectionUpdate` — the only thing NoteEditor re-rendered the bar from —
  // never fires, and the bar kept showing TextFormatGroup instead of the
  // language select until the caret happened to move. Mounted through the
  // real `NoteEditor` tree, since the bug lives in the gap between the
  // editor's own transaction and NoteEditor's re-render, not in EditorToolbar
  // alone.
  it('switches to the language select right after Insert code block, though the caret never moves', async () => {
    const { container, getByLabelText } = render(
      <NoteEditor
        content="hello world"
        notePath="/ws/a.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
      />,
    )
    const pmEl = editorRoot(container)
    await waitFor(() => expect(pmEl.textContent).toContain('hello world'))
    clickInto(pmEl)

    fireEvent.click(getByLabelText('Insert code block'))

    await waitFor(() => expect(getByLabelText('Code block language')).toBeInTheDocument())
  })
})
