import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, createEvent, fireEvent, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
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

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined)
  read.mockReset().mockResolvedValue(null)
  useInkStore.setState({
    tool: 'rect',
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

const PAGE: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [] }

// jsdom computes no offsetX/offsetY, so page coordinates are set by hand.
function at(canvas: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) {
  const event = createEvent[type](canvas, { pointerType: 'pen', pointerId: 1 })
  Object.defineProperty(event, 'offsetX', { value: x })
  Object.defineProperty(event, 'offsetY', { value: y })
  fireEvent(canvas, event)
}

async function mountCanvas(props: Partial<ComponentProps<typeof InkCanvas>> = {}, loaded: InkData = PAGE) {
  read.mockResolvedValue(loaded)
  const view = render(<InkCanvas svgPath={SRC} width={800} height={600} {...props} />)
  await waitFor(() => expect(read).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 0))
  const canvas = view.container.querySelector('canvas')!
  return { ...view, canvas }
}

function drawRect(canvas: Element, x1: number, y1: number, x2: number, y2: number) {
  at(canvas, 'pointerDown', x1, y1)
  at(canvas, 'pointerUp', x2, y2)
}

function lastWrite(): InkData {
  const call = write.mock.calls[write.mock.calls.length - 1]
  if (!call) throw new Error('nothing written')
  return call[1]
}

describe('growing in every direction', () => {
  it('moves the origin, not the ink, when a shape nears the left and top edges', async () => {
    const { canvas } = await mountCanvas({ autoGrow: true, growAllSides: true })
    drawRect(canvas, 50, 50, 300, 300)

    const saved = lastWrite()
    expect(saved).toMatchObject({ originX: -400, originY: -400, width: 1200, height: 1000 })
    expect(saved.shapes[0]).toMatchObject({ x1: 50, y1: 50, x2: 300, y2: 300 })
  })

  it('keeps a fixed origin without growAllSides', async () => {
    const { canvas } = await mountCanvas({ autoGrow: true })
    drawRect(canvas, 50, 50, 300, 300)

    expect(lastWrite()).toMatchObject({ originX: 0, originY: 0, width: 800, height: 600 })
  })
})

describe('pointer mapping', () => {
  const GROWN: InkData = { ...PAGE, originX: -400, originY: -200, width: 1200, height: 800 }

  it('adds the origin to every pointer position', async () => {
    const { canvas } = await mountCanvas({ autoGrow: true, growAllSides: true }, GROWN)
    drawRect(canvas, 500, 400, 700, 500)

    expect(lastWrite().shapes[0]).toMatchObject({ x1: 100, y1: 200, x2: 300, y2: 300 })
  })

  it('divides by zoom before adding the origin', async () => {
    const { canvas } = await mountCanvas({ autoGrow: true, growAllSides: true, zoom: 2 }, GROWN)
    drawRect(canvas, 1000, 800, 1400, 1000)

    expect(lastWrite().shapes[0]).toMatchObject({ x1: 100, y1: 200, x2: 300, y2: 300 })
  })
})

describe('rendering at a non-zero origin', () => {
  const GROWN: InkData = { ...PAGE, originX: -400, originY: 0, width: 1200, height: 600 }

  it('places the label editor at the text position minus the origin', async () => {
    useInkStore.setState({ tool: 'text' })
    const { canvas, container } = await mountCanvas({ autoGrow: true, growAllSides: true }, GROWN)
    at(canvas, 'pointerDown', 500, 100)
    at(canvas, 'pointerUp', 500, 100)

    const editor = await waitFor(() => {
      const el = container.querySelector<HTMLTextAreaElement>('textarea.ink-text-editor')
      if (!el) throw new Error('editor not open')
      return el
    })
    expect(editor.style.left).toBe('500px')
    expect(editor.style.top).toBe('100px')
  })

  it('keeps the grid aligned to ink coordinates', async () => {
    const { canvas } = await mountCanvas({ zoom: 2 }, GROWN)
    expect(canvas.style.backgroundPosition).toBe('800px 0px')
  })
})
