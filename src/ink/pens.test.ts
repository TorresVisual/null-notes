import { describe, it, expect } from 'vitest'
import { DEFAULT_PENS, parsePens, withPen } from './pens'
import type { Pen } from './types'

const pen: Pen = { id: 'fine', label: 'Fine', color: '#e6edf3', size: 2, opacity: 1 }

describe('parsePens', () => {
  it('reads back a saved set of pens', () => {
    expect(parsePens(JSON.stringify([pen]))).toEqual([pen])
  })

  it('returns null when nothing is stored', () => {
    expect(parsePens(null)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parsePens('{not json')).toBeNull()
  })

  it('rejects an empty list rather than leaving the toolbar with no pens', () => {
    expect(parsePens('[]')).toBeNull()
  })

  it('rejects the set if any pen is missing a field', () => {
    expect(parsePens(JSON.stringify([pen, { id: 'x', label: 'X', color: '#fff' }]))).toBeNull()
  })

  it('rejects a non-array', () => {
    expect(parsePens(JSON.stringify(pen))).toBeNull()
  })
})

describe('withPen', () => {
  it('replaces the matching pen and leaves the rest alone', () => {
    const updated = withPen(DEFAULT_PENS, { ...pen, color: '#ff7b72' })
    expect(updated.find((p) => p.id === 'fine')?.color).toBe('#ff7b72')
    expect(updated).toHaveLength(DEFAULT_PENS.length)
    expect(updated.find((p) => p.id === 'broad')).toEqual(
      DEFAULT_PENS.find((p) => p.id === 'broad'),
    )
  })
})

describe('DEFAULT_PENS', () => {
  it('ships highlighters as translucent pens, not a separate tool', () => {
    const highlighters = DEFAULT_PENS.filter((p) => p.opacity < 1)
    expect(highlighters.length).toBeGreaterThan(0)
    for (const highlighter of highlighters) {
      expect(highlighter.size).toBeGreaterThan(10)
    }
  })
})
