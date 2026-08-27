import { describe, it, expect } from 'vitest'
import { GROW_MARGIN, PAGE_STEP, reachOfPoints, growCanvas } from './growCanvas'

describe('reachOfPoints', () => {
  it('finds the furthest x and y among the points', () => {
    expect(reachOfPoints([{ x: 10, y: 500 }, { x: 300, y: 20 }])).toEqual({ maxX: 300, maxY: 500 })
  })

  it('reaches (0, 0) for no points, rather than -Infinity', () => {
    expect(reachOfPoints([])).toEqual({ maxX: 0, maxY: 0 })
  })
})

describe('growCanvas', () => {
  it('leaves both dimensions alone when nothing is near an edge', () => {
    expect(growCanvas(800, 600, { maxX: 400, maxY: 300 }, true)).toEqual({ width: 800, height: 600 })
  })

  it('grows width when content nears the right edge', () => {
    const reach = { maxX: 800 - GROW_MARGIN + 1, maxY: 0 }
    expect(growCanvas(800, 600, reach, true)).toEqual({ width: 800 + PAGE_STEP, height: 600 })
  })

  it('grows height when content nears the bottom edge', () => {
    const reach = { maxX: 0, maxY: 600 - GROW_MARGIN + 1 }
    expect(growCanvas(800, 600, reach, true)).toEqual({ width: 800, height: 600 + PAGE_STEP })
  })

  it('grows both dimensions when content nears the bottom-right corner', () => {
    const reach = { maxX: 800 - GROW_MARGIN + 1, maxY: 600 - GROW_MARGIN + 1 }
    expect(growCanvas(800, 600, reach, true)).toEqual({ width: 800 + PAGE_STEP, height: 600 + PAGE_STEP })
  })

  // Never grows the left or top edge — see the module's own comment for why:
  // that would require translating every existing stroke/shape/text plus
  // compensating the scroll position, not just enlarging the box.
  it('never grows from content near the origin', () => {
    expect(growCanvas(800, 600, { maxX: 0, maxY: 0 }, true)).toEqual({ width: 800, height: 600 })
  })

  it('does nothing when autoGrow is off, regardless of reach', () => {
    const reach = { maxX: 10000, maxY: 10000 }
    expect(growCanvas(800, 600, reach, false)).toEqual({ width: 800, height: 600 })
  })
})
