import { describe, it, expect } from 'vitest'
import { pointToSegmentDistance, hitTestShape } from './hitTest'
import type { Shape } from './types'

describe('pointToSegmentDistance', () => {
  it('returns 0 for a point on the segment', () => {
    expect(pointToSegmentDistance(5, 0, 0, 0, 10, 0)).toBe(0)
  })

  it('returns perpendicular distance for a point off the segment', () => {
    expect(pointToSegmentDistance(5, 5, 0, 0, 10, 0)).toBe(5)
  })

  it('clamps to the nearest endpoint beyond the segment', () => {
    expect(pointToSegmentDistance(20, 0, 0, 0, 10, 0)).toBe(10)
  })

  it('falls back to point distance for a zero-length segment', () => {
    expect(pointToSegmentDistance(3, 4, 0, 0, 0, 0)).toBe(5)
  })
})

describe('hitTestShape', () => {
  const line: Shape = { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, color: '#000', size: 2 }
  const rect: Shape = { id: 'r1', kind: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', size: 2 }
  const circle: Shape = { id: 'c1', kind: 'circle', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', size: 2 }
  const arrow: Shape = { id: 'a1', kind: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0, color: '#000', size: 2 }

  it('hits a line within radius', () => {
    expect(hitTestShape(line, 5, 1, 2)).toBe(true)
  })

  it('misses a line beyond radius', () => {
    expect(hitTestShape(line, 5, 10, 2)).toBe(false)
  })

  it('hits an arrow the same as a line', () => {
    expect(hitTestShape(arrow, 5, 1, 2)).toBe(true)
  })

  it('hits a rect near its edge', () => {
    expect(hitTestShape(rect, 5, 0, 1)).toBe(true)
  })

  it('misses a rect interior far from any edge', () => {
    expect(hitTestShape(rect, 5, 5, 1)).toBe(false)
  })

  it('hits a circle near its ring', () => {
    expect(hitTestShape(circle, 5, 0, 1)).toBe(true)
  })

  it('misses a circle at its center', () => {
    expect(hitTestShape(circle, 5, 5, 1)).toBe(false)
  })
})
