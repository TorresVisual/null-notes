import { describe, it, expect } from 'vitest'
import { DEFAULT_PENS } from './pens'
import { DEFAULT_THINNING, strokeKind, strokeOptions } from './strokeOptions'

describe('strokeKind', () => {
  it('treats anything translucent as a highlighter, whatever its thinning', () => {
    expect(strokeKind({ opacity: 0.3, thinning: undefined })).toBe('highlighter')
    expect(strokeKind({ opacity: 0.99, thinning: 0.1 })).toBe('highlighter')
  })

  it('treats an opaque stroke with thinning <= 0.2 as a pencil', () => {
    expect(strokeKind({ opacity: 1, thinning: 0.1 })).toBe('pencil')
    expect(strokeKind({ opacity: 1, thinning: 0.2 })).toBe('pencil')
  })

  it('treats everything else as ink, including a stroke with no thinning stored', () => {
    expect(strokeKind({ opacity: 1, thinning: 0.21 })).toBe('ink')
    expect(strokeKind({ opacity: 1, thinning: undefined })).toBe('ink')
  })

  it('keeps every default pen preset in the kind it was designed as', () => {
    const kinds = Object.fromEntries(DEFAULT_PENS.map((p) => [p.id, strokeKind(p)]))
    expect(kinds).toEqual({
      fine: 'ink',
      broad: 'ink',
      red: 'ink',
      blue: 'ink',
      pencil: 'pencil',
      'highlight-yellow': 'highlighter',
      'highlight-green': 'highlighter',
    })
  })
})

describe('strokeOptions', () => {
  it('lets pen pressure drive the width', () => {
    for (const pen of DEFAULT_PENS) {
      expect(strokeOptions(pen).simulatePressure).toBe(false)
    }
  })

  it('passes size and thinning through, defaulting thinning', () => {
    expect(strokeOptions({ size: 5, opacity: 1, thinning: 0.1 })).toMatchObject({ size: 5, thinning: 0.1 })
    expect(strokeOptions({ size: 5, opacity: 1, thinning: undefined })).toMatchObject({
      size: 5,
      thinning: DEFAULT_THINNING,
    })
  })
})
