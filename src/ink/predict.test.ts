import { describe, it, expect } from 'vitest'
import { mergePredicted } from './predict'
import type { Point } from './types'

const p = (x: number): Point => ({ x, y: 0, pressure: 0.5 })

describe('mergePredicted', () => {
  it('appends predicted points after the real ones, in order', () => {
    expect(mergePredicted([p(1), p(2)], [p(3), p(4)])).toEqual([p(1), p(2), p(3), p(4)])
  })

  it('returns the live buffer untouched when nothing is predicted', () => {
    const live = [p(1)]
    expect(mergePredicted(live, [])).toBe(live)
  })

  // The live buffer becomes the saved stroke; a prediction in it is ink the
  // pen never drew.
  it('never mutates the live buffer', () => {
    const live = [p(1), p(2)]
    mergePredicted(live, [p(3)])
    expect(live).toEqual([p(1), p(2)])
  })
})
