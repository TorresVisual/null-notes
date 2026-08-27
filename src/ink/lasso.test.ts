import { describe, it, expect } from 'vitest'
import {
  pointInPolygon,
  strokeInLasso,
  shapeInLasso,
  selectionIn,
  translateSelection,
  translatePolygon,
  deleteSelection,
  selectionBottom,
  isSelectionEmpty,
  EMPTY_SELECTION,
} from './lasso'
import type { InkData, Shape, Stroke } from './types'

// A 100x100 box with its top-left at the origin.
const box = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

function stroke(id: string, points: [number, number][]): Stroke {
  return {
    id,
    points: points.map(([x, y]) => ({ x, y, pressure: 0.5 })),
    color: '#e6edf3',
    size: 2,
    opacity: 1,
  }
}

const rect: Shape = {
  id: 'r1',
  kind: 'rect',
  x1: 10, y1: 10, x2: 40, y2: 40,
  color: '#e6edf3',
  size: 2,
}

describe('pointInPolygon', () => {
  it('finds a point inside', () => {
    expect(pointInPolygon(50, 50, box)).toBe(true)
  })

  it('rejects a point outside', () => {
    expect(pointInPolygon(150, 50, box)).toBe(false)
  })

  // A freehand lasso is rarely convex — a C-shaped loop must not claim the gap.
  it('respects a concave loop', () => {
    const cShape = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]
    expect(pointInPolygon(20, 50, cShape)).toBe(true)
    expect(pointInPolygon(70, 50, cShape)).toBe(false)
  })

  it('encloses nothing when given a degenerate polygon', () => {
    expect(pointInPolygon(50, 50, [])).toBe(false)
    expect(pointInPolygon(50, 50, [{ x: 0, y: 0 }, { x: 100, y: 100 }])).toBe(false)
  })
})

describe('strokeInLasso', () => {
  it('takes a stroke that is fully enclosed', () => {
    expect(strokeInLasso(stroke('s1', [[10, 10], [20, 20]]), box)).toBe(true)
  })

  // Containment, not intersection — clipping a tail must not grab the word.
  it('leaves a stroke that only pokes into the loop', () => {
    expect(strokeInLasso(stroke('s1', [[50, 50], [150, 50]]), box)).toBe(false)
  })

  it('leaves a stroke entirely outside', () => {
    expect(strokeInLasso(stroke('s1', [[200, 200], [300, 300]]), box)).toBe(false)
  })

  it('does not select an empty stroke', () => {
    expect(strokeInLasso(stroke('s1', []), box)).toBe(false)
  })
})

describe('shapeInLasso', () => {
  it('takes a rectangle whose every corner is enclosed', () => {
    expect(shapeInLasso(rect, box)).toBe(true)
  })

  it('leaves a rectangle hanging out of the loop', () => {
    expect(shapeInLasso({ ...rect, x2: 400 }, box)).toBe(false)
  })

  // A diagonal line's bounding box can stick out where the line itself does not,
  // so endpoints are what count for lines and arrows.
  it('judges a line by its endpoints', () => {
    const line: Shape = { ...rect, kind: 'line', x1: 10, y1: 90, x2: 90, y2: 10 }
    expect(shapeInLasso(line, box)).toBe(true)
  })
})

describe('selectionIn', () => {
  const data: InkData = {
    width: 800,
    height: 600,
    strokes: [stroke('in', [[10, 10], [20, 20]]), stroke('out', [[500, 500]])],
    shapes: [rect, { ...rect, id: 'r2', x1: 300, x2: 400 }],
    texts: [],
  }

  it('returns only what the loop encloses', () => {
    expect(selectionIn(data, box)).toEqual({ strokeIds: ['in'], shapeIds: ['r1'] })
  })

  it('selects nothing for a tap or a straight flick', () => {
    expect(selectionIn(data, [])).toEqual(EMPTY_SELECTION)
    expect(selectionIn(data, [{ x: 0, y: 0 }, { x: 50, y: 50 }])).toEqual(EMPTY_SELECTION)
  })
})

describe('translateSelection', () => {
  const data: InkData = {
    width: 800,
    height: 600,
    strokes: [stroke('a', [[10, 10]]), stroke('b', [[10, 10]])],
    shapes: [rect],
    texts: [],
  }

  it('moves the selected stroke and leaves the rest where they were', () => {
    const moved = translateSelection(data, { strokeIds: ['a'], shapeIds: [] }, 5, 7)
    expect(moved.strokes[0]?.points[0]).toMatchObject({ x: 15, y: 17 })
    expect(moved.strokes[1]?.points[0]).toMatchObject({ x: 10, y: 10 })
  })

  it('keeps pressure when moving a point', () => {
    const moved = translateSelection(data, { strokeIds: ['a'], shapeIds: [] }, 5, 7)
    expect(moved.strokes[0]?.points[0]?.pressure).toBe(0.5)
  })

  it('moves both corners of a shape so its size is unchanged', () => {
    const moved = translateSelection(data, { strokeIds: [], shapeIds: ['r1'] }, 5, 7)
    expect(moved.shapes[0]).toMatchObject({ x1: 15, y1: 17, x2: 45, y2: 47 })
  })
})

describe('translatePolygon', () => {
  it('carries the marquee along with what it holds', () => {
    expect(translatePolygon([{ x: 0, y: 0 }], 5, 7)).toEqual([{ x: 5, y: 7 }])
  })
})

describe('deleteSelection', () => {
  it('drops only the selected strokes and shapes', () => {
    const data: InkData = {
      width: 800,
      height: 600,
      strokes: [stroke('a', [[1, 1]]), stroke('b', [[2, 2]])],
      shapes: [rect],
      texts: [],
    }
    const left = deleteSelection(data, { strokeIds: ['a'], shapeIds: ['r1'] })
    expect(left.strokes.map((s) => s.id)).toEqual(['b'])
    expect(left.shapes).toHaveLength(0)
  })
})

describe('selectionBottom', () => {
  it('reports the lowest point the selection reaches', () => {
    const data: InkData = {
      width: 800,
      height: 600,
      strokes: [stroke('a', [[0, 120], [0, 340]])],
      shapes: [{ ...rect, id: 'r1', y1: 10, y2: 500 }],
      texts: [],
    }
    expect(selectionBottom(data, { strokeIds: ['a'], shapeIds: [] })).toBe(340)
    expect(selectionBottom(data, { strokeIds: [], shapeIds: ['r1'] })).toBe(500)
  })
})

describe('isSelectionEmpty', () => {
  it('is true only when nothing is held', () => {
    expect(isSelectionEmpty(EMPTY_SELECTION)).toBe(true)
    expect(isSelectionEmpty({ strokeIds: ['a'], shapeIds: [] })).toBe(false)
    expect(isSelectionEmpty({ strokeIds: [], shapeIds: ['r1'] })).toBe(false)
  })
})
