import { describe, it, expect } from 'vitest'
import { GROW_MARGIN, PAGE_STEP, EMPTY_BOUNDS, boundsOfPoints, inkBounds, growCanvas } from './growCanvas'
import type { InkData } from './types'

describe('boundsOfPoints', () => {
  it('finds the extremes among the points on both axes', () => {
    expect(boundsOfPoints([{ x: 10, y: 500 }, { x: 300, y: 20 }])).toEqual({
      minX: 10, minY: 20, maxX: 300, maxY: 500,
    })
  })

  it('is EMPTY_BOUNDS for no points, which sits inside no margin', () => {
    expect(boundsOfPoints([])).toEqual(EMPTY_BOUNDS)
  })
})

describe('inkBounds', () => {
  const data: InkData = {
    width: 800, height: 600, strokes: [], shapes: [], texts: [],
  }

  it('is EMPTY_BOUNDS for an empty page', () => {
    expect(inkBounds(data)).toEqual(EMPTY_BOUNDS)
  })

  it('covers strokes, shape corners and text, including ink at negative coordinates', () => {
    const bounds = inkBounds({
      ...data,
      strokes: [{ id: 's', points: [{ x: -50, y: 20, pressure: 0.5 }, { x: 10, y: 30, pressure: 0.5 }], color: '#000', size: 2, opacity: 1 }],
      shapes: [{ id: 'r', kind: 'rect', x1: 100, y1: -70, x2: 400, y2: 90, color: '#000', size: 2 }],
      texts: [{ id: 't', x: 5, y: 5, text: 'hi', color: '#000', size: 20 }],
    })
    expect(bounds.minX).toBe(-50)
    expect(bounds.minY).toBe(-70)
    expect(bounds.maxX).toBe(400)
    expect(bounds.maxY).toBeGreaterThanOrEqual(90)
  })
})

const reach = (maxX: number, maxY: number) => ({ minX: 0, minY: 0, maxX, maxY })

describe('growCanvas', () => {
  it('leaves both dimensions alone when nothing is near an edge', () => {
    expect(growCanvas(800, 600, reach(400, 300), true)).toEqual({ width: 800, height: 600 })
  })

  it('grows width when content nears the right edge', () => {
    expect(growCanvas(800, 600, reach(800 - GROW_MARGIN + 1, 0), true)).toEqual({ width: 800 + PAGE_STEP, height: 600 })
  })

  it('grows height when content nears the bottom edge', () => {
    expect(growCanvas(800, 600, reach(0, 600 - GROW_MARGIN + 1), true)).toEqual({ width: 800, height: 600 + PAGE_STEP })
  })

  it('grows both dimensions when content nears the bottom-right corner', () => {
    expect(growCanvas(800, 600, reach(800 - GROW_MARGIN + 1, 600 - GROW_MARGIN + 1), true)).toEqual({
      width: 800 + PAGE_STEP,
      height: 600 + PAGE_STEP,
    })
  })

  it('never grows from content near the origin', () => {
    expect(growCanvas(800, 600, EMPTY_BOUNDS, true)).toEqual({ width: 800, height: 600 })
  })

  it('does nothing when autoGrow is off, regardless of reach', () => {
    expect(growCanvas(800, 600, reach(10000, 10000), false)).toEqual({ width: 800, height: 600 })
  })
})
