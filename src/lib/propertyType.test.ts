import { describe, it, expect } from 'vitest'
import { inferType } from './propertyType'

describe('inferType', () => {
  it.each([
    ['2026-10-31', 'date'],
    ['2026-10-31T10:00', 'datetime'],
    ['2026-10-31T10:00:30', 'datetime'],
    [true, 'checkbox'],
    [3, 'number'],
    [['a'], 'list'],
    ['x', 'text'],
    ['2026-13-45x', 'text'],
    [null, 'text'],
  ])('%j is %s', (value, expected) => {
    expect(inferType(value)).toBe(expected)
  })
})
