import { describe, it, expect } from 'vitest'
import { paintOrder } from './paintOrder'
import type { Stroke } from './types'

function stroke(id: string, opacity: number): Stroke {
  return { id, points: [], color: '#000000', size: 2, opacity }
}

describe('paintOrder', () => {
  it('puts translucent strokes under opaque ones', () => {
    const ordered = paintOrder([stroke('ink', 1), stroke('highlight', 0.3)])
    expect(ordered.map((s) => s.id)).toEqual(['highlight', 'ink'])
  })

  it('keeps drawing order within each layer', () => {
    const ordered = paintOrder([
      stroke('ink1', 1),
      stroke('hl1', 0.3),
      stroke('ink2', 1),
      stroke('hl2', 0.5),
    ])
    expect(ordered.map((s) => s.id)).toEqual(['hl1', 'hl2', 'ink1', 'ink2'])
  })

  it('leaves an all-opaque page untouched', () => {
    const strokes = [stroke('a', 1), stroke('b', 1)]
    expect(paintOrder(strokes).map((s) => s.id)).toEqual(['a', 'b'])
  })
})
