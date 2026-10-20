import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, createEvent, fireEvent, waitFor, screen } from '@testing-library/react'
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

    await screen.findByRole('button', { name: 'Fine' })
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

describe('draw ribbon in the overlay', () => {
  it('switches tools from the letter shortcuts', () => {
    const { overlay } = mount()

    fireEvent.keyDown(overlay, { key: 'e' })
    expect(useInkStore.getState().tool).toBe('eraser')
    fireEvent.keyDown(overlay, { key: 'L' })
    expect(useInkStore.getState().tool).toBe('lasso')
    fireEvent.keyDown(overlay, { key: 'p' })
    expect(useInkStore.getState().tool).toBe('pen')
    fireEvent.keyDown(overlay, { key: 't' })
    expect(useInkStore.getState().tool).toBe('text')
  })

  it('leaves the tool alone for chords', () => {
    const { overlay } = mount()

    fireEvent.keyDown(overlay, { key: 'e', ctrlKey: true })

    expect(useInkStore.getState().tool).toBe('text')
  })

  // `e` and `t` are in the word being typed.
  it('does not switch tools while a label is being typed', async () => {
    mount()
    const editor = await openLabel('start')

    fireEvent.keyDown(editor, { key: 'e' })

    expect(useInkStore.getState().tool).toBe('text')
  })

  it('does not switch tools while a flyout slider has focus', () => {
    useInkStore.setState({ tool: 'pen' })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))
    const slider = screen.getByLabelText('Pen thickness')

    fireEvent.keyDown(slider, { key: 'e' })

    expect(useInkStore.getState().tool).toBe('pen')
  })

  it('closes an open flyout on Escape without closing the overlay, then closes the overlay', () => {
    useInkStore.setState({ tool: 'pen' })
    const { overlay, onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))
    const slider = screen.getByLabelText('Pen thickness')

    fireEvent.keyDown(slider, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Pen thickness')).toBeNull()

    fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('infinite page', () => {
  it('grows left and up when ink nears the top-left corner', async () => {
    useInkStore.setState({ tool: 'rect' })
    mount()
    const canvas = document.querySelector('canvas')!
    const at = (type: 'pointerDown' | 'pointerUp', x: number, y: number) => {
      const event = createEvent[type](canvas, { pointerType: 'pen', pointerId: 1 })
      Object.defineProperty(event, 'offsetX', { value: x })
      Object.defineProperty(event, 'offsetY', { value: y })
      fireEvent(canvas, event)
    }
    at('pointerDown', 40, 40)
    at('pointerUp', 200, 200)

    await waitFor(() => expect(write).toHaveBeenCalled())
    expect(write.mock.calls[0]?.[1]).toMatchObject({ originX: -400, originY: -400 })
  })
})
