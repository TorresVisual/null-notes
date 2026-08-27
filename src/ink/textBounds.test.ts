import { describe, it, expect } from 'vitest'
import { measureTextItem, pointInTextItem, translateTextItem } from './textBounds'
import type { TextItem } from './types'

const item: TextItem = { id: 't1', x: 100, y: 100, text: 'hello', color: '#000', size: 20 }

describe('measureTextItem', () => {
  it('grows width with the longest line and height with line count', () => {
    const one = measureTextItem(item)
    const two = measureTextItem({ ...item, text: 'hello\nworld again' })
    expect(two.width).toBeGreaterThan(one.width)
    expect(two.height).toBeGreaterThan(one.height)
  })

  it('never collapses to zero width for empty text', () => {
    const bounds = measureTextItem({ ...item, text: '' })
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
  })
})

describe('pointInTextItem', () => {
  it('hits a point inside the estimated box', () => {
    expect(pointInTextItem(item, 105, 105)).toBe(true)
  })

  it('misses a point above or left of the item origin', () => {
    expect(pointInTextItem(item, 50, 50)).toBe(false)
  })

  it('misses a point well past the estimated box', () => {
    expect(pointInTextItem(item, 1000, 1000)).toBe(false)
  })
})

describe('translateTextItem', () => {
  it('moves the item by the given offset and leaves everything else alone', () => {
    const moved = translateTextItem(item, 5, -10)
    expect(moved).toEqual({ ...item, x: 105, y: 90 })
  })

  it('returns a new object rather than mutating the original', () => {
    const moved = translateTextItem(item, 1, 1)
    expect(moved).not.toBe(item)
    expect(item.x).toBe(100)
  })
})
