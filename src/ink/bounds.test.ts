import { describe, it, expect } from 'vitest'
import { EMPTY_BOUNDS, boundsOfPoints, inkBounds, CROP_PADDING, MIN_EXTENT, extentOf } from './bounds'
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

describe('extentOf', () => {
  const dot: InkData = {
    originX: 0,
    originY: 0,
    width: 9999,
    height: 9999,
    strokes: [
      {
        id: 'a',
        points: [
          { x: 500, y: 500, pressure: 0.5 },
          { x: 510, y: 510, pressure: 0.5 },
        ],
        color: '#000000',
        size: 4,
        opacity: 1,
      },
    ],
    shapes: [],
    texts: [],
  }

  it('wraps small ink in at least MIN_EXTENT, keeping the ink plus padding inside', () => {
    const out = extentOf(dot)

    expect(out.width).toBeGreaterThanOrEqual(MIN_EXTENT)
    expect(out.height).toBeGreaterThanOrEqual(MIN_EXTENT)
    expect(out.originX).toBeLessThanOrEqual(500 - CROP_PADDING)
    expect(out.originY).toBeLessThanOrEqual(500 - CROP_PADDING)
    expect(out.originX + out.width).toBeGreaterThanOrEqual(510 + CROP_PADDING)
    expect(out.originY + out.height).toBeGreaterThanOrEqual(510 + CROP_PADDING)
  })

  it('is ink bounds plus padding when that already exceeds the minimum', () => {
    const wide: InkData = {
      ...dot,
      strokes: [{ ...dot.strokes[0]!, points: [{ x: -300, y: 0, pressure: 0.5 }, { x: 900, y: 400, pressure: 0.5 }] }],
    }
    const out = extentOf(wide)

    expect(out).toMatchObject({ originX: -340, originY: -40, width: 1280, height: 480 })
  })

  it('gives an empty drawing a finite minimum extent at the origin', () => {
    expect(extentOf({ ...dot, strokes: [] })).toMatchObject({
      originX: 0,
      originY: 0,
      width: MIN_EXTENT,
      height: MIN_EXTENT,
    })
  })

  it('is idempotent', () => {
    const once = extentOf(dot)
    expect(extentOf(once)).toEqual(once)
  })

  it('leaves strokes, shapes and texts untouched', () => {
    const out = extentOf(dot)
    expect(out.strokes).toBe(dot.strokes)
    expect(out.shapes).toBe(dot.shapes)
    expect(out.texts).toBe(dot.texts)
  })
})
