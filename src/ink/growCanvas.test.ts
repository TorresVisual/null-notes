import { describe, it, expect } from 'vitest'
import { GROW_MARGIN, PAGE_STEP, MAX_EXTENT, EMPTY_BOUNDS, boundsOfPoints, inkBounds, growCanvas, scrollShift } from './growCanvas'
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
    originX: 0,
    originY: 0,
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

const page = { originX: 0, originY: 0, width: 800, height: 600 }
const bounds = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY })
const inside = bounds(300, 300, 400, 400)

describe('growCanvas', () => {
  it('leaves the page alone when nothing is near an edge', () => {
    expect(growCanvas(page, inside, true, true)).toEqual(page)
  })

  it('does nothing when autoGrow is off, however far the ink reaches', () => {
    expect(growCanvas(page, bounds(-9000, -9000, 9000, 9000), false, true)).toEqual(page)
  })

  it('grows right and down by one step, as before, without growAllSides', () => {
    expect(growCanvas(page, bounds(300, 300, 800 - GROW_MARGIN + 1, 400), true, false))
      .toEqual({ ...page, width: 800 + PAGE_STEP })
    expect(growCanvas(page, bounds(300, 300, 400, 600 - GROW_MARGIN + 1), true, false))
      .toEqual({ ...page, height: 600 + PAGE_STEP })
  })

  // Review Focus 4: inline canvases share the hook and must keep a fixed origin.
  it('never moves the origin without growAllSides', () => {
    expect(growCanvas(page, bounds(-500, -500, 400, 400), true, false)).toEqual(page)
  })

  it('grows left and up by moving the origin, leaving the far edges where they were', () => {
    expect(growCanvas(page, bounds(GROW_MARGIN - 1, 300, 400, 400), true, true))
      .toEqual({ originX: -PAGE_STEP, originY: 0, width: 800 + PAGE_STEP, height: 600 })
    expect(growCanvas(page, bounds(300, GROW_MARGIN - 1, 400, 400), true, true))
      .toEqual({ originX: 0, originY: -PAGE_STEP, width: 800, height: 600 + PAGE_STEP })
  })

  it('treats the margin boundary as inside: exactly GROW_MARGIN from the edge does not grow', () => {
    expect(growCanvas(page, bounds(GROW_MARGIN, GROW_MARGIN, 800 - GROW_MARGIN, 600 - GROW_MARGIN), true, true))
      .toEqual(page)
  })

  it('grows every side at once', () => {
    expect(growCanvas(page, bounds(0, 0, 800, 600), true, true)).toEqual({
      originX: -PAGE_STEP, originY: -PAGE_STEP, width: 800 + 2 * PAGE_STEP, height: 600 + 2 * PAGE_STEP,
    })
  })

  // Review Focus 3: a lasso drag or paste can overshoot by several steps.
  it('grows several steps at once for an overshoot, enough to clear the margin', () => {
    const grown = growCanvas(page, bounds(-1000, 300, 400, 400), true, true)
    expect(grown.originX).toBe(-3 * PAGE_STEP)
    expect(grown.width).toBe(800 + 3 * PAGE_STEP)
    expect(-1000).toBeGreaterThan(grown.originX + GROW_MARGIN - 1)
  })

  // Review Focus 2
  it('does not grow for empty bounds', () => {
    expect(growCanvas(page, EMPTY_BOUNDS, true, true)).toEqual(page)
  })

  it('stops a side at the extent cap', () => {
    const wide = { ...page, width: MAX_EXTENT }
    expect(growCanvas(wide, bounds(0, 300, MAX_EXTENT, 400), true, true)).toEqual(wide)
  })

  it('shares the remaining room, low side first, when both sides want more than fits', () => {
    const nearCap = { ...page, width: MAX_EXTENT - PAGE_STEP }
    const grown = growCanvas(nearCap, bounds(0, 300, MAX_EXTENT - PAGE_STEP, 400), true, true)
    expect(grown.originX).toBe(-PAGE_STEP)
    expect(grown.width).toBe(MAX_EXTENT)
  })

  it('does not shrink a page that is already past the cap', () => {
    const huge = { ...page, width: 9000 }
    expect(growCanvas(huge, bounds(0, 300, 9000, 400), true, true)).toEqual(huge)
  })
})

describe('scrollShift', () => {
  it('advances the scroll by the new space added before the ink, at zoom', () => {
    expect(scrollShift({ originX: 0, originY: 0 }, { originX: -400, originY: -800 }, 2)).toEqual({ dx: 800, dy: 1600 })
  })

  it('goes back by the same amount when undo restores the old origin', () => {
    expect(scrollShift({ originX: -400, originY: 0 }, { originX: 0, originY: 0 }, 2)).toEqual({ dx: -800, dy: 0 })
  })

  it('is zero when the origin did not move', () => {
    expect(scrollShift({ originX: -400, originY: 0 }, { originX: -400, originY: 0 }, 1.5)).toEqual({ dx: 0, dy: 0 })
  })
})
