import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_PENS,
  DEFAULT_ERASER_SIZE,
  clampEraserSize,
  loadEraserSize,
  saveEraserSize,
  parsePens,
  withPen,
} from './pens'
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

describe('loadEraserSize', () => {
  beforeEach(() => localStorage.clear())

  // Number(null) is 0, which is finite and so clamps to the minimum. Reading a
  // missing key that way left a fresh install with an eraser too small to see.
  it('gives the default when nothing has been stored', () => {
    expect(loadEraserSize()).toBe(DEFAULT_ERASER_SIZE)
  })

  it('gives the default for a stored value that is not a size', () => {
    localStorage.setItem('null-notes.ink.eraserSize', 'nonsense')
    expect(loadEraserSize()).toBe(DEFAULT_ERASER_SIZE)
    localStorage.setItem('null-notes.ink.eraserSize', '')
    expect(loadEraserSize()).toBe(DEFAULT_ERASER_SIZE)
  })

  it('reads back a size that was saved', () => {
    saveEraserSize(36)
    expect(loadEraserSize()).toBe(36)
  })
})

describe('clampEraserSize', () => {
  it('leaves a sensible size alone', () => {
    expect(clampEraserSize(30)).toBe(30)
  })

  it('holds the eraser within a usable range', () => {
    expect(clampEraserSize(0)).toBe(4)
    expect(clampEraserSize(500)).toBe(80)
  })

  // An absent key reads back as NaN through Number(null), which must not
  // become an eraser of size NaN.
  it('falls back to the default for a value that is not a number', () => {
    expect(clampEraserSize(Number('nonsense'))).toBe(DEFAULT_ERASER_SIZE)
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

  // P13-2: the pencil is thin and drawn with a low `thinning` (a near-
  // constant width regardless of pressure) rather than a second rendering
  // path — the same "preset, not a new subsystem" pattern the highlighter
  // above already follows for wide-and-translucent.
  it('ships a pencil as a thin, low-thinning pen, not a highlighter', () => {
    const pencil = DEFAULT_PENS.find((p) => p.id === 'pencil')
    expect(pencil).toBeDefined()
    expect(pencil!.opacity).toBe(1)
    expect(pencil!.size).toBeLessThan(5)
    expect(pencil!.thinning).toBeLessThan(0.5)
  })
})

describe('the thinning field', () => {
  it('is optional on parsePens for pens saved before P13-2 existed', () => {
    const legacyPen = { id: 'fine', label: 'Fine', color: '#e6edf3', size: 2, opacity: 1 }
    expect(parsePens(JSON.stringify([legacyPen]))).toEqual([legacyPen])
  })

  it('is accepted and preserved when present', () => {
    const withThinning: Pen = { ...pen, id: 'pencil', thinning: 0.1 }
    expect(parsePens(JSON.stringify([withThinning]))).toEqual([withThinning])
  })

  it('rejects a non-numeric thinning value', () => {
    const bad = { ...pen, thinning: 'thin' }
    expect(parsePens(JSON.stringify([bad]))).toBeNull()
  })
})
