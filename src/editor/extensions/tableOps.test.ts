import { describe, it, expect } from 'vitest'
import { gapIndex, gapToTarget } from './tableOps'

describe('drag drop targets', () => {
  const mids = [10, 30, 50]

  it('counts the midpoints the pointer has passed', () => {
    expect(gapIndex(mids, 0)).toBe(0)
    expect(gapIndex(mids, 35)).toBe(2)
    expect(gapIndex(mids, 99)).toBe(3)
  })

  it('never drops above the minimum gap', () => {
    expect(gapIndex(mids, 0, 1)).toBe(1)
  })

  it('maps a gap to the moved item\'s final index', () => {
    expect(gapToTarget(3, 0)).toBe(2)
    expect(gapToTarget(1, 1)).toBe(1)
    expect(gapToTarget(0, 2)).toBe(0)
  })
})
