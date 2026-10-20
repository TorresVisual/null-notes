import { describe, it, expect } from 'vitest'
import {
  centredRuler,
  rulerEndpoints,
  distanceToRuler,
  positionAlong,
  grabKind,
  moveRuler,
  rotateRulerTowards,
  shouldSnap,
  projectOntoRuler,
  snapStroke,
  SNAP_DISTANCE,
  GRAB_DISTANCE,
} from './ruler'
import type { Ruler } from './ruler'
import type { Point } from './types'

// A horizontal ruler 200 long, centred at (100, 100): it spans x 0..200 at y=100.
const flat: Ruler = { x: 100, y: 100, angle: 0, length: 200 }

function point(x: number, y: number): Point {
  return { x, y, pressure: 0.5 }
}

describe('centredRuler', () => {
  it('lands in the middle of the page, lying flat', () => {
    const ruler = centredRuler(800, 600)
    expect(ruler).toMatchObject({ x: 400, y: 300, angle: 0 })
  })

  it('centres horizontally on the page, wherever its origin is', () => {
    expect(centredRuler(1200, 600, -400)).toMatchObject({ x: 200, y: 300 })
  })
})

describe('rulerEndpoints', () => {
  it('puts the ends half a length either side of the centre', () => {
    const [a, b] = rulerEndpoints(flat)
    expect(a.x).toBeCloseTo(0)
    expect(b.x).toBeCloseTo(200)
    expect(a.y).toBeCloseTo(100)
    expect(b.y).toBeCloseTo(100)
  })

  it('follows the angle', () => {
    const [, b] = rulerEndpoints({ ...flat, angle: Math.PI / 2 })
    expect(b.x).toBeCloseTo(100)
    expect(b.y).toBeCloseTo(200)
  })
})

describe('distanceToRuler', () => {
  it('measures straight across the edge', () => {
    expect(distanceToRuler(100, 130, flat)).toBeCloseTo(30)
  })

  it('measures from the end once past it', () => {
    expect(distanceToRuler(230, 100, flat)).toBeCloseTo(30)
  })
})

describe('positionAlong', () => {
  it('runs 0 to 1 from end to end', () => {
    expect(positionAlong(0, 100, flat)).toBeCloseTo(0)
    expect(positionAlong(100, 100, flat)).toBeCloseTo(0.5)
    expect(positionAlong(200, 100, flat)).toBeCloseTo(1)
  })

  it('clamps rather than running off the end', () => {
    expect(positionAlong(-500, 100, flat)).toBe(0)
    expect(positionAlong(900, 100, flat)).toBe(1)
  })
})

describe('grabKind', () => {
  it('ignores a pen nowhere near the ruler', () => {
    expect(grabKind(100, 400, flat)).toBeNull()
  })

  it('takes the middle as a slide', () => {
    expect(grabKind(100, 100, flat)).toBe('move')
  })

  it('takes either end as a swing', () => {
    expect(grabKind(10, 100, flat)).toBe('rotate')
    expect(grabKind(190, 100, flat)).toBe('rotate')
  })

  // Reaching for the straightedge is deliberate; drawing against it is not.
  it('only grabs within reach of the edge', () => {
    expect(grabKind(100, 100 + GRAB_DISTANCE - 1, flat)).toBe('move')
    expect(grabKind(100, 100 + GRAB_DISTANCE + 1, flat)).toBeNull()
  })
})

describe('moveRuler', () => {
  it('slides without turning', () => {
    expect(moveRuler(flat, 10, -5)).toMatchObject({ x: 110, y: 95, angle: 0 })
  })
})

describe('rotateRulerTowards', () => {
  it('pivots about the centre, leaving it put', () => {
    const turned = rotateRulerTowards(flat, 100, 300)
    expect(turned.x).toBe(100)
    expect(turned.y).toBe(100)
    expect(turned.angle).toBeCloseTo(Math.PI / 2)
  })

  // Dragging the left end towards the pen must not flip the ruler end for end.
  it('points the grabbed end at the pen', () => {
    const turned = rotateRulerTowards(flat, 0, 0)
    const [a] = rulerEndpoints(turned)
    expect(a.x).toBeLessThan(100)
    expect(a.y).toBeLessThan(100)
  })
})

describe('shouldSnap', () => {
  it('snaps a stroke that starts against the edge', () => {
    expect(shouldSnap(point(100, 100 + SNAP_DISTANCE - 1), flat)).toBe(true)
  })

  it('leaves a stroke that starts away from it alone', () => {
    expect(shouldSnap(point(100, 100 + SNAP_DISTANCE + 1), flat)).toBe(false)
  })
})

describe('projectOntoRuler', () => {
  it('drops the point onto the edge', () => {
    const p = projectOntoRuler(point(150, 130), flat)
    expect(p.x).toBeCloseTo(150)
    expect(p.y).toBeCloseTo(100)
  })

  it('keeps pressure', () => {
    expect(projectOntoRuler(point(150, 130), flat).pressure).toBe(0.5)
  })

  // Running off the end keeps the line straight instead of piling every
  // remaining point onto the last inch of the ruler.
  it('extends past the ends rather than bunching up', () => {
    expect(projectOntoRuler(point(400, 130), flat).x).toBeCloseTo(400)
  })
})

describe('snapStroke', () => {
  it('flattens a wobbly stroke onto one straight line', () => {
    const snapped = snapStroke([point(20, 90), point(60, 115), point(140, 95)], flat)
    expect(snapped.map((p) => p.y)).toEqual([100, 100, 100])
    expect(snapped.map((p) => p.x)).toEqual([20, 60, 140])
  })
})
