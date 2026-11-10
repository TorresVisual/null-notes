import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { InkCanvas } from './InkCanvas'
import { useInkStore } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { InkData } from './types'

const write = vi.fn<(path: string, data: InkData) => Promise<void>>().mockResolvedValue(undefined)
const read = vi.fn<(path: string) => Promise<InkData | null>>().mockResolvedValue(null)

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: (path: string) => read(path),
    write: (path: string, data: InkData) => write(path, data),
  },
}))

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined)
  read.mockReset().mockResolvedValue(null)
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
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" onSaved={onSaved} />)
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
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" onSaved={onSaved} />)
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
      <InkCanvas svgPath="/ws/N.ink/a.svg" onSaved={onSaved} />,
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
    render(<InkCanvas svgPath="/ws/N.ink/a.svg" autoActivate />)

    await waitFor(() => expect(useInkStore.getState().activeCanvasId).toBe('/ws/N.ink/a.svg'))
    expect(useInkStore.getState().activeCanvas).not.toBeNull()
  })

  it('stays unregistered without the flag', async () => {
    render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useInkStore.getState().activeCanvasId).toBeNull()
  })
})

describe('Delete reaches only the canvas that owns the selection', () => {
  const INK_WITH_STROKE: InkData = {
    originX: 0,
    originY: 0,
    width: 700,
    height: 400,
    strokes: [
      {
        id: 'st1',
        points: [
          { x: 120, y: 120, pressure: 0.5 },
          { x: 150, y: 150, pressure: 0.5 },
        ],
        color: '#000000',
        size: 2,
        opacity: 1,
        thinning: 0.5,
      },
    ],
    shapes: [],
    texts: [],
  }

  // Lassoes the stroke above, leaving the canvas with a live selection. With no
  // measured viewport the camera sits at the origin, so client coordinates are
  // ink coordinates.
  function selectStrokeIn(container: HTMLElement) {
    const canvas = container.querySelector('canvas')!
    const at = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => {
      fireEvent[type](canvas, { pointerType: 'pen', pointerId: 1, clientX: x, clientY: y })
    }
    at('pointerDown', 100, 100)
    at('pointerMove', 200, 100)
    at('pointerMove', 200, 200)
    at('pointerMove', 100, 200)
    at('pointerUp', 100, 100)
  }

  beforeEach(() => {
    useInkStore.setState({ tool: 'lasso' })
    read.mockResolvedValue(INK_WITH_STROKE)
  })

  it('deletes the selection on the canvas that owns it', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    await waitFor(() => expect(read).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    selectStrokeIn(container)
    write.mockClear()

    fireEvent.keyDown(window, { key: 'Delete' })

    expect(write).toHaveBeenCalledTimes(1)
  })

  it('leaves a selection on a canvas that no longer owns the slot alone', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    await waitFor(() => expect(read).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    selectStrokeIn(container)
    useInkStore.getState().setActiveCanvas('/ws/N.ink/b.svg', {
      undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false, deleteSelected: vi.fn(),
      hasSelection: false, toggleRuler: vi.fn(), rulerOn: false, zoom: 1, setZoom: vi.fn(), cropToContent: vi.fn(),
    })
    write.mockClear()

    fireEvent.keyDown(window, { key: 'Delete' })

    expect(write).not.toHaveBeenCalled()
  })
})
