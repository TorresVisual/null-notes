import { describe, it, expect } from 'vitest'
import { splitStrokePoints, eraseFromStroke, erasePoint, eraseWholeStrokes, erase } from './pointEraser'
import type { InkData, Point, Shape, Stroke } from './types'

function points(...xs: number[]): Point[] {
  return xs.map((x) => ({ x, y: 0, pressure: 0.5 }))
}

function stroke(id: string, pts: Point[]): Stroke {
  return { id, points: pts, color: '#e6edf3', size: 2, opacity: 1 }
}

// Deterministic ids so a split is assertable.
function idFactory() {
  let n = 0
  return () => `new-${n++}`
}

describe('splitStrokePoints', () => {
  // The whole point of Phase 4: rubbing out the middle of a word leaves the
  // two halves, rather than taking the word with it.
  it('splits a stroke into the runs either side of the eraser', () => {
    const runs = splitStrokePoints(points(0, 10, 50, 90, 100), 50, 0, 15)
    expect(runs).toHaveLength(2)
    expect(runs[0]?.map((p) => p.x)).toEqual([0, 10])
    expect(runs[1]?.map((p) => p.x)).toEqual([90, 100])
  })

  it('leaves an untouched stroke whole', () => {
    const runs = splitStrokePoints(points(0, 10, 20), 500, 0, 15)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toHaveLength(3)
  })

  it('erases the stroke entirely when every point is under the eraser', () => {
    expect(splitStrokePoints(points(0, 5, 10), 5, 0, 50)).toEqual([])
  })

  it('trims from the end without splitting', () => {
    const runs = splitStrokePoints(points(0, 10, 20, 100), 100, 0, 15)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.map((p) => p.x)).toEqual([0, 10, 20])
  })

  // A single leftover point has no direction to outline — the same rule that
  // discards a stray tap when drawing.
  it('discards a run too short to be a stroke', () => {
    const runs = splitStrokePoints(points(0, 50, 90, 100), 50, 0, 15)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.map((p) => p.x)).toEqual([90, 100])
  })

  it('keeps pressure on the surviving points', () => {
    const runs = splitStrokePoints(points(0, 10, 100), 100, 0, 15)
    expect(runs[0]?.[0]?.pressure).toBe(0.5)
  })
})

describe('eraseFromStroke', () => {
  it('returns the identical stroke when nothing was touched', () => {
    const s = stroke('a', points(0, 10, 20))
    expect(eraseFromStroke(s, 500, 0, 15, idFactory())[0]).toBe(s)
  })

  it('gives the first fragment the original id and the rest fresh ones', () => {
    const s = stroke('a', points(0, 10, 50, 90, 100))
    const fragments = eraseFromStroke(s, 50, 0, 15, idFactory())
    expect(fragments.map((f) => f.id)).toEqual(['a', 'new-0'])
  })

  it('carries colour, size and opacity onto every fragment', () => {
    const s: Stroke = { ...stroke('a', points(0, 10, 50, 90, 100)), color: '#e3b341', opacity: 0.3 }
    for (const fragment of eraseFromStroke(s, 50, 0, 15, idFactory())) {
      expect(fragment).toMatchObject({ color: '#e3b341', size: 2, opacity: 0.3 })
    }
  })

  it('returns nothing when the stroke is wholly erased', () => {
    expect(eraseFromStroke(stroke('a', points(0, 5)), 5, 0, 50, idFactory())).toEqual([])
  })
})

describe('erasePoint', () => {
  const rect: Shape = {
    id: 'r1', kind: 'rect', x1: 200, y1: 200, x2: 300, y2: 300, color: '#e6edf3', size: 2,
  }

  const data: InkData = {
    originX: 0,
    originY: 0,
    width: 800,
    height: 600,
    strokes: [stroke('a', points(0, 10, 50, 90, 100))],
    shapes: [rect],
    texts: [],
  }

  it('splits strokes in place', () => {
    const next = erasePoint(data, 50, 0, 15, idFactory())
    expect(next.strokes.map((s) => s.id)).toEqual(['a', 'new-0'])
  })

  // A rectangle cut in half is not a rectangle, so shapes still go whole.
  it('erases a shape whole rather than splitting it', () => {
    const next = erasePoint(data, 200, 200, 15, idFactory())
    expect(next.shapes).toHaveLength(0)
    expect(next.strokes).toHaveLength(1)
  })

  // Identity matters: the eraser drag fires per sample, and only a changed
  // object should cost a redraw or a file write.
  it('returns the very same object when the eraser touched nothing', () => {
    expect(erasePoint(data, 700, 500, 15, idFactory())).toBe(data)
  })
})

describe('eraseWholeStrokes', () => {
  const rect: Shape = {
    id: 'r1', kind: 'rect', x1: 200, y1: 200, x2: 300, y2: 300, color: '#e6edf3', size: 2,
  }

  const data: InkData = {
    originX: 0,
    originY: 0,
    width: 800,
    height: 600,
    strokes: [stroke('a', points(0, 10, 50, 90, 100)), stroke('b', points(400, 410))],
    shapes: [rect],
    texts: [],
  }

  // The difference from the point eraser: touching the middle takes all of it,
  // leaving no crumbs either side.
  it('takes the whole stroke on contact', () => {
    const next = eraseWholeStrokes(data, 50, 0, 15)
    expect(next.strokes.map((s) => s.id)).toEqual(['b'])
  })

  it('leaves strokes it never touched', () => {
    expect(eraseWholeStrokes(data, 700, 500, 15).strokes).toHaveLength(2)
  })

  it('still erases shapes whole', () => {
    expect(eraseWholeStrokes(data, 200, 200, 15).shapes).toHaveLength(0)
  })

  it('returns the very same object when nothing was touched', () => {
    expect(eraseWholeStrokes(data, 700, 500, 15)).toBe(data)
  })
})

describe('erase', () => {
  const data: InkData = {
    originX: 0,
    originY: 0,
    width: 800,
    height: 600,
    strokes: [stroke('a', points(0, 10, 50, 90, 100))],
    shapes: [],
    texts: [],
  }

  it('splits in point mode and removes whole in stroke mode', () => {
    expect(erase(data, 50, 0, 15, 'point', idFactory()).strokes).toHaveLength(2)
    expect(erase(data, 50, 0, 15, 'stroke', idFactory()).strokes).toHaveLength(0)
  })
})
