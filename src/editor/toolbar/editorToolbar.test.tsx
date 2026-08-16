import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
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

  // The load-bearing rule. Reaching for undo must not deselect the canvas that
  // undo is meant to act on, so the bar never lets a press move focus.
  it('does not clear the active canvas when a button is pressed', () => {
    useInkStore.getState().setActiveCanvas('a', handle({ canUndo: true }))
    const { getByLabelText } = render(<EditorToolbar editor={null} notePath="/ws/a.md" />)

    fireEvent.mouseDown(getByLabelText('Undo'))

    expect(useInkStore.getState().activeCanvas).not.toBeNull()
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
})
