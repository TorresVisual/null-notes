import { describe, it, expect } from 'vitest'
import { straightLineEnds } from './straighten'
import type { Point } from './types'

function p(x: number, y: number): Point {
  return { x, y, pressure: 0.5 }
}

describe('straightLineEnds', () => {
  it('accepts a perfectly straight stroke', () => {
    const points = [p(0, 0), p(25, 0), p(50, 0), p(75, 0), p(100, 0)]
    expect(straightLineEnds(points)).toEqual({ x1: 0, y1: 0, x2: 100, y2: 0 })
  })

  it('accepts a stroke with only jitter-level deviation', () => {
    const points = [p(0, 0), p(25, 1), p(50, -1), p(75, 1), p(100, 0)]
    expect(straightLineEnds(points)).toEqual({ x1: 0, y1: 0, x2: 100, y2: 0 })
  })

  it('rejects a stroke that bows well past the threshold', () => {
    const points = [p(0, 0), p(25, 20), p(50, 30), p(75, 20), p(100, 0)]
    expect(straightLineEnds(points)).toBeNull()
  })

  it('rejects a closed loop, whose endpoints coincide', () => {
    const points = [p(0, 0), p(50, 50), p(0, 0)]
    expect(straightLineEnds(points)).toBeNull()
  })
})
