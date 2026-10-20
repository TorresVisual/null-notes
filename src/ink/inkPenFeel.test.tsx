import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, createEvent, fireEvent, waitFor } from '@testing-library/react'
import { InkCanvas } from './InkCanvas'
import { useInkStore } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { InkData, Stroke } from './types'

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
const PAGE: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [] }

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

// jsdom has no 2D context, so painting is normally a silent no-op. A proxy that
// counts every method call lets a test observe how much painting happened
// without caring what was painted.
function installFakeContext() {
  const calls: Record<string, number> = {}
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined
      if (prop in target) return target[prop]
      return () => {
        calls[prop] = (calls[prop] ?? 0) + 1
      }
    },
    set: (target, prop, value) => {
      if (typeof prop === 'string') target[prop] = value
      return true
    },
  })
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation((() => ctx) as unknown as HTMLCanvasElement['getContext'])
  return { calls, restore: () => spy.mockRestore() }
}

type PointerKind = 'pen' | 'mouse' | 'touch'

interface PointerOptions {
  kind?: PointerKind
  button?: number
  predicted?: Array<[number, number]>
}

// jsdom computes no offsetX/offsetY, so page coordinates are set by hand.
function at(
  canvas: Element,
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  y: number,
  { kind = 'pen', button, predicted }: PointerOptions = {},
) {
  const event = createEvent[type](canvas, {
    pointerType: kind,
    pointerId: 1,
    pressure: 0.5,
    ...(button === undefined ? {} : { button }),
  })
  Object.defineProperty(event, 'offsetX', { value: x })
  Object.defineProperty(event, 'offsetY', { value: y })
  // jsdom's getCoalescedEvents() returns [], a real pointermove always lists itself.
  Object.defineProperty(event, 'getCoalescedEvents', { value: undefined })
  if (predicted) {
    const events = predicted.map(([px, py]) => ({ offsetX: px, offsetY: py, pressure: 0.5, pointerType: kind }))
    Object.defineProperty(event, 'getPredictedEvents', { value: () => events })
  }
  fireEvent(canvas, event)
}

// A V shape: far enough from straight that auto-straighten leaves it a stroke.
function drawBent(canvas: Element, options: PointerOptions = {}) {
  at(canvas, 'pointerDown', 10, 10, options)
  at(canvas, 'pointerMove', 60, 80, options)
  at(canvas, 'pointerMove', 110, 10, options)
  at(canvas, 'pointerUp', 110, 10, options)
}

async function mountCanvas(loaded: InkData = PAGE) {
  read.mockResolvedValue(loaded)
  const view = render(<InkCanvas svgPath={SRC} width={800} height={600} />)
  await waitFor(() => expect(read).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { ...view, canvas: view.container.querySelector('canvas')! }
}

function lastWrite(): InkData {
  const call = write.mock.calls[write.mock.calls.length - 1]
  if (!call) throw new Error('nothing written')
  return call[1]
}

function existingStrokes(count: number): Stroke[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    color: '#ffffff',
    size: 2,
    opacity: 1,
    points: [
      { x: 10, y: 100 + i * 20, pressure: 0.5 },
      { x: 100, y: 130 + i * 20, pressure: 0.5 },
      { x: 200, y: 100 + i * 20, pressure: 0.5 },
    ],
  }))
}

describe('committed layer cache', () => {
  it('paints only the live stroke on pointer-move, not the ink already on the page', async () => {
    const fake = installFakeContext()
    try {
      const { canvas } = await mountCanvas({ ...PAGE, strokes: existingStrokes(5) })
      fake.calls.fill = 0

      at(canvas, 'pointerDown', 10, 400)
      at(canvas, 'pointerMove', 60, 420)
      await waitFor(() => expect(fake.calls.fill).toBeGreaterThan(0))

      expect(fake.calls.fill).toBe(1)
    } finally {
      fake.restore()
    }
  })

  // Review Focus 2: a cache that outlives an edit leaves the new stroke
  // invisible until the file is reopened.
  it('repaints the committed ink after a commit and again after undo', async () => {
    const fake = installFakeContext()
    try {
      const { canvas } = await mountCanvas({ ...PAGE, strokes: existingStrokes(5) })

      at(canvas, 'pointerDown', 10, 400)
      at(canvas, 'pointerMove', 60, 480)
      at(canvas, 'pointerMove', 110, 400)
      await waitFor(() => expect(fake.calls.fill).toBeGreaterThan(0))

      fake.calls.fill = 0
      at(canvas, 'pointerUp', 110, 400)
      await waitFor(() => expect(fake.calls.fill).toBe(6))

      fake.calls.fill = 0
      useInkStore.getState().activeCanvas?.undo()
      await waitFor(() => expect(fake.calls.fill).toBe(5))
    } finally {
      fake.restore()
    }
  })
})
