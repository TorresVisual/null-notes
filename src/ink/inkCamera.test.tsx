import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, createEvent, fireEvent, waitFor, act } from '@testing-library/react'
import { InkCanvas } from './InkCanvas'
import { useInkStore } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { InkData, Stroke } from './types'

const write = vi.fn<(path: string, data: InkData) => Promise<void>>()
const read = vi.fn<(path: string) => Promise<InkData | null>>()

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: (path: string) => read(path),
    write: (path: string, data: InkData) => write(path, data),
  },
}))

const SRC = '/ws/N.ink/a.svg'
const VIEWPORT = { width: 800, height: 600 }

// Ink spanning (1000,500)–(2600,1700) in an 800×600 viewport fits at scale 0.5,
// which puts the camera at x 1000, y 500.
const BIG_LINE: InkData = {
  originX: 0,
  originY: 0,
  width: 3000,
  height: 2000,
  strokes: [],
  shapes: [{ id: 'big', kind: 'line', x1: 1000, y1: 500, x2: 2600, y2: 1700, color: '#000000', size: 2 }],
  texts: [],
}

function stroke(id: string, x: number, y: number): Stroke {
  return {
    id,
    points: [
      { x, y, pressure: 0.5 },
      { x: x + 30, y: y + 10, pressure: 0.5 },
      { x: x + 50, y: y + 50, pressure: 0.5 },
    ],
    color: '#000000',
    size: 4,
    opacity: 1,
  }
}

interface Call {
  name: string
  args: unknown[]
}

function installRecordingContext() {
  const calls: Call[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined
      if (prop in target) return target[prop]
      return (...args: unknown[]) => {
        calls.push({ name: prop, args })
      }
    },
    set: (target, prop, value) => {
      if (typeof prop === 'string') target[prop] = value
      return true
    },
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ctx) as unknown as HTMLCanvasElement['getContext'],
  )
  return calls
}

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined)
  read.mockReset().mockResolvedValue(null)
  vi.stubGlobal('devicePixelRatio', 2)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        left: 0,
        top: 0,
        right: VIEWPORT.width,
        bottom: VIEWPORT.height,
        x: 0,
        y: 0,
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        toJSON: () => ({}),
      }) as DOMRect,
  )
  useInkStore.setState({
    tool: 'line',
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
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const scaleOf = () => useInkStore.getState().activeCanvas?.zoom

// Handlers are re-bound after a render, so a tool switch has to settle before the next pointer.
function selectTool(tool: 'pen' | 'rect' | 'text' | 'eraser') {
  act(() => useInkStore.setState({ tool }))
}

async function mount(data: InkData | null, props: Partial<Parameters<typeof InkCanvas>[0]> = {}) {
  read.mockResolvedValue(data)
  const utils = render(<InkCanvas svgPath={SRC} autoActivate {...props} />)
  const canvas = utils.container.querySelector('canvas') as HTMLCanvasElement
  return { ...utils, canvas }
}

function pointer(
  target: Element,
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  y: number,
  pointerType = 'pen',
) {
  const event = createEvent[type](target, { pointerType, pointerId: 1, clientX: x, clientY: y, pressure: 0.5 })
  // jsdom's getCoalescedEvents() returns [], a real pointermove always lists itself.
  Object.defineProperty(event, 'getCoalescedEvents', { value: undefined })
  fireEvent(target, event)
}

describe('the camera canvas', () => {
  it('maps a drag through the camera into ink coordinates', async () => {
    const { canvas } = await mount(BIG_LINE)
    await waitFor(() => expect(scaleOf()).toBe(0.5))

    pointer(canvas, 'pointerDown', 100, 100)
    pointer(canvas, 'pointerMove', 150, 120)
    pointer(canvas, 'pointerUp', 200, 150)

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const written = write.mock.calls[0]?.[1]
    expect(written?.shapes).toHaveLength(2)
    expect(written?.shapes[1]).toMatchObject({ x1: 1200, y1: 700, x2: 1400, y2: 800 })
  })

  it('sizes the canvas to the viewport and never resizes it when zooming', async () => {
    const { canvas, container } = await mount(BIG_LINE)
    await waitFor(() => expect(canvas.width).toBe(1600))
    expect(canvas.height).toBe(1200)

    fireEvent.wheel(container.firstElementChild as Element, { ctrlKey: true, deltaY: -800, clientX: 400, clientY: 300 })
    await waitFor(() => expect(scaleOf()).toBeGreaterThan(0.5))

    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(1200)
  })

  it('paints only the strokes that touch the viewport', async () => {
    const calls = installRecordingContext()
    const data: InkData = {
      originX: 0,
      originY: 0,
      width: 800,
      height: 600,
      strokes: [stroke('near', 100, 100), stroke('far', 100000, 100000)],
      shapes: [],
      texts: [],
    }
    await mount(data, { backdrop: { dataUrl: 'data:image/png;base64,AAAA', width: 800, height: 600 } })
    await waitFor(() => expect(scaleOf()).toBe(1))
    await waitFor(() => expect(calls.some((c) => c.name === 'fill')).toBe(true))

    const lastClear = calls.map((c) => c.name).lastIndexOf('clearRect')
    const lastFrame = calls.slice(lastClear)
    expect(lastFrame.filter((c) => c.name === 'fill')).toHaveLength(1)
  })

  it('positions the label editor and the eraser cursor through the camera', async () => {
    const { canvas, container } = await mount(BIG_LINE)
    await waitFor(() => expect(scaleOf()).toBe(0.5))

    selectTool('text')
    pointer(canvas, 'pointerDown', 300, 200)
    pointer(canvas, 'pointerUp', 300, 200)
    const label = await waitFor(() => {
      const el = container.querySelector<HTMLTextAreaElement>('textarea.ink-text-editor')
      if (!el) throw new Error('label editor not open')
      return el
    })
    expect(label.style.left).toBe('300px')
    expect(label.style.top).toBe('200px')
    expect(label.style.fontSize).toBe('9px')

    fireEvent.blur(label)
    selectTool('eraser')
    pointer(canvas, 'pointerMove', 400, 250)
    const cursor = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.ink-eraser-cursor')
      if (!el) throw new Error('no eraser cursor')
      return el
    })
    expect(cursor.style.left).toBe('400px')
    expect(cursor.style.top).toBe('250px')
    expect(cursor.style.width).toBe('6px')
  })

  it('writes once per gesture for a pen stroke, a shape and a label', async () => {
    const { canvas, container } = await mount(BIG_LINE)
    await waitFor(() => expect(scaleOf()).toBe(0.5))

    selectTool('pen')
    pointer(canvas, 'pointerDown', 100, 100)
    pointer(canvas, 'pointerMove', 160, 220)
    pointer(canvas, 'pointerMove', 220, 120)
    pointer(canvas, 'pointerUp', 280, 240)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(write.mock.calls[0]?.[1].strokes).toHaveLength(1)

    selectTool('rect')
    pointer(canvas, 'pointerDown', 300, 300)
    pointer(canvas, 'pointerMove', 360, 340)
    pointer(canvas, 'pointerUp', 400, 380)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write.mock.calls[1]?.[1].shapes).toHaveLength(2)

    selectTool('text')
    pointer(canvas, 'pointerDown', 500, 100)
    pointer(canvas, 'pointerUp', 500, 100)
    const label = await waitFor(() => {
      const el = container.querySelector<HTMLTextAreaElement>('textarea.ink-text-editor')
      if (!el) throw new Error('label editor not open')
      return el
    })
    fireEvent.change(label, { target: { value: 'hi' } })
    fireEvent.blur(label)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3))
    expect(write.mock.calls[2]?.[1].texts).toHaveLength(1)

    const handle = useInkStore.getState().activeCanvas
    handle?.undo()
    await waitFor(() => expect(write).toHaveBeenCalledTimes(4))
    expect(write.mock.calls[3]?.[1].texts).toHaveLength(0)
  })
})
