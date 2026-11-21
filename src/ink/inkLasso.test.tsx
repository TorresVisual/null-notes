import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, createEvent, fireEvent, waitFor, act } from '@testing-library/react'
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

const SRC = '/ws/N.ink/a.svg'
const PAGE: InkData = {
  originX: 0,
  originY: 0,
  width: 800,
  height: 600,
  strokes: [
    {
      id: 's0',
      color: '#ffffff',
      size: 2,
      opacity: 1,
      points: [
        { x: 10, y: 100, pressure: 0.5 },
        { x: 100, y: 130, pressure: 0.5 },
        { x: 200, y: 100, pressure: 0.5 },
      ],
    },
  ],
  shapes: [],
  texts: [],
}

const BARREL_WITH_TIP = 3

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined)
  read.mockReset().mockResolvedValue(null)
  useInkStore.setState({
    tool: 'pen',
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

// With no measured viewport the camera sits at the origin, so client coordinates are ink coordinates.
function at(target: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number, buttons = 1) {
  const event = createEvent[type](target, {
    pointerType: 'pen',
    pointerId: 1,
    pressure: 0.5,
    clientX: x,
    clientY: y,
    buttons,
  })
  Object.defineProperty(event, 'getCoalescedEvents', { value: undefined })
  fireEvent(target, event)
}

async function mountCanvas() {
  read.mockResolvedValue(PAGE)
  const view = render(<InkCanvas svgPath={SRC} />)
  await waitFor(() => expect(read).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { ...view, canvas: view.container.querySelector('canvas')! }
}

// A loop round the one stroke, drawn with the barrel button held — the tool in
// the toolbar stays the pen throughout.
function lassoTheStroke(canvas: Element, buttons = BARREL_WITH_TIP) {
  at(canvas, 'pointerDown', 0, 80, buttons)
  at(canvas, 'pointerMove', 250, 80, buttons)
  at(canvas, 'pointerMove', 250, 160, buttons)
  at(canvas, 'pointerMove', 0, 160, buttons)
  at(canvas, 'pointerUp', 0, 160, buttons)
}

function lastWrite(): InkData {
  const call = write.mock.calls[write.mock.calls.length - 1]
  if (!call) throw new Error('nothing written')
  return call[1]
}

describe('barrel-button lasso', () => {
  it('selects with the pen tool still in hand, and offers actions on the marquee', async () => {
    const { canvas, queryByRole } = await mountCanvas()
    expect(queryByRole('button', { name: 'Duplicate selection' })).toBeNull()
    lassoTheStroke(canvas)
    expect(queryByRole('button', { name: 'Duplicate selection' })).not.toBeNull()
    expect(queryByRole('button', { name: 'Delete selection' })).not.toBeNull()
    expect(useInkStore.getState().tool).toBe('pen')
    expect(write).not.toHaveBeenCalled()
  })

  it('draws, not selects, without the button', async () => {
    const { canvas, queryByRole } = await mountCanvas()
    lassoTheStroke(canvas, 1)
    expect(queryByRole('button', { name: 'Duplicate selection' })).toBeNull()
    expect(lastWrite().strokes).toHaveLength(2)
  })

  it('drops the marquee when the pen goes back to writing', async () => {
    const { canvas, queryByRole } = await mountCanvas()
    lassoTheStroke(canvas)
    at(canvas, 'pointerDown', 500, 400, 1)
    at(canvas, 'pointerUp', 500, 400, 1)
    expect(queryByRole('button', { name: 'Duplicate selection' })).toBeNull()
  })

  it('swallows the context menu Windows raises for the barrel button', async () => {
    const { canvas } = await mountCanvas()
    const event = createEvent.contextMenu(canvas)
    fireEvent(canvas, event)
    expect(event.defaultPrevented).toBe(true)
  })
})

// The button can change under the pen mid-gesture. What the gesture is was
// decided when the tip landed; flipping tool halfway would truncate it.
describe('a button change mid-gesture', () => {
  it('lets go of the barrel button without losing the lasso', async () => {
    const { canvas, queryByRole } = await mountCanvas()
    at(canvas, 'pointerDown', 0, 80, BARREL_WITH_TIP)
    at(canvas, 'pointerMove', 250, 80, BARREL_WITH_TIP)
    at(canvas, 'pointerMove', 250, 160, 1)
    at(canvas, 'pointerMove', 0, 160, 1)
    at(canvas, 'pointerUp', 0, 160, 1)
    expect(queryByRole('button', { name: 'Duplicate selection' })).not.toBeNull()
  })

  it('presses the barrel button halfway through a stroke without cutting it short', async () => {
    const { canvas } = await mountCanvas()
    at(canvas, 'pointerDown', 10, 10, 1)
    at(canvas, 'pointerMove', 60, 80, 1)
    at(canvas, 'pointerMove', 110, 10, BARREL_WITH_TIP)
    at(canvas, 'pointerUp', 110, 10, BARREL_WITH_TIP)
    const points = lastWrite().strokes[1]?.points
    expect(points?.[points.length - 1]).toMatchObject({ x: 110, y: 10 })
  })
})

describe('selection actions', () => {
  // The selection names ink that undo just took away; keeping the marquee would
  // leave a bar acting on ids that no longer exist.
  it('drops the marquee when undo takes its ink away', async () => {
    const { canvas, getByRole, queryByRole } = await mountCanvas()
    lassoTheStroke(canvas)
    fireEvent.click(getByRole('button', { name: 'Duplicate selection' }))
    act(() => useInkStore.getState().activeCanvas?.undo())
    expect(queryByRole('button', { name: 'Duplicate selection' })).toBeNull()
  })

  it('drops the marquee after undoing a resize, which would otherwise no longer fit the ink', async () => {
    const { canvas, container, queryByRole } = await mountCanvas()
    lassoTheStroke(canvas)
    const handle = container.querySelector('.ink-resize-handle')
    if (!handle) throw new Error('no resize handle')
    at(handle, 'pointerDown', 250, 160)
    at(handle, 'pointerMove', 500, 240)
    at(handle, 'pointerUp', 500, 240)
    act(() => useInkStore.getState().activeCanvas?.undo())
    expect(queryByRole('button', { name: 'Duplicate selection' })).toBeNull()
  })

  it('duplicates, then selects the copy so deleting removes only the copy', async () => {
    const { canvas, getByRole } = await mountCanvas()
    lassoTheStroke(canvas)

    fireEvent.click(getByRole('button', { name: 'Duplicate selection' }))
    expect(write).toHaveBeenCalledTimes(1)
    expect(lastWrite().strokes).toHaveLength(2)
    expect(new Set(lastWrite().strokes.map((s) => s.id)).size).toBe(2)

    fireEvent.click(getByRole('button', { name: 'Delete selection' }))
    expect(write).toHaveBeenCalledTimes(2)
    expect(lastWrite().strokes.map((s) => s.id)).toEqual(['s0'])
  })

  it('resizes from the corner handle in one write, however far the pen wanders', async () => {
    const { canvas, container } = await mountCanvas()
    lassoTheStroke(canvas)
    const handle = container.querySelector('.ink-resize-handle')
    if (!handle) throw new Error('no resize handle')

    // The marquee spans (0,80)-(250,160); dragging its corner to (500,240) doubles it about (0,80).
    at(handle, 'pointerDown', 250, 160)
    at(handle, 'pointerMove', 300, 180)
    at(handle, 'pointerMove', 500, 240)
    expect(write).not.toHaveBeenCalled()
    at(handle, 'pointerUp', 500, 240)

    expect(write).toHaveBeenCalledTimes(1)
    const stroke = lastWrite().strokes[0]
    expect(stroke?.points[0]).toMatchObject({ x: 20, y: 120 })
    expect(stroke?.size).toBe(2)
  })
})
