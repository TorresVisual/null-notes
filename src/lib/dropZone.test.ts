import { describe, it, expect } from 'vitest'
import { dropZoneAt } from './dropZone'

const rect = { left: 100, top: 50, width: 1000, height: 800 }
const at = (fx: number, fy: number, groups = 1) =>
  dropZoneAt(rect, rect.left + fx * rect.width, rect.top + fy * rect.height, groups)

describe('dropZoneAt', () => {
  it('maps the outer quarter of each edge to that side when there is one group', () => {
    expect(at(0.9, 0.5)).toBe('right')
    expect(at(0.1, 0.5)).toBe('left')
    expect(at(0.5, 0.1)).toBe('up')
    expect(at(0.5, 0.9)).toBe('down')
  })

  it('is the center in the middle half', () => {
    expect(at(0.5, 0.5)).toBe('center')
    expect(at(0.26, 0.74)).toBe('center')
  })

  it('lets the nearest edge win in a corner', () => {
    expect(at(0.05, 0.2)).toBe('left')
    expect(at(0.2, 0.05)).toBe('up')
  })

  it('is always the center when two groups exist', () => {
    expect(at(0.95, 0.5, 2)).toBe('center')
    expect(at(0.5, 0.02, 2)).toBe('center')
  })
})
