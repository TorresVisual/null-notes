import { describe, it, expect } from 'vitest'
import { sameLayerKey, type LayerKey } from './layerCache'
import type { InkData } from './types'

const data: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [] }
const key: LayerKey = { inkData: data, scale: 2, editingTextId: null }

describe('sameLayerKey', () => {
  it('misses when nothing is cached yet', () => {
    expect(sameLayerKey(null, key)).toBe(false)
  })

  it('hits when every part matches', () => {
    expect(sameLayerKey(key, { ...key })).toBe(true)
  })

  it('misses on a new InkData object, even with identical contents', () => {
    expect(sameLayerKey(key, { ...key, inkData: { ...data } })).toBe(false)
  })

  it('misses when zoom or device pixel ratio changes the backing scale', () => {
    expect(sameLayerKey(key, { ...key, scale: 3 })).toBe(false)
  })

  it('misses when a different text item starts or stops being edited', () => {
    expect(sameLayerKey(key, { ...key, editingTextId: 't1' })).toBe(false)
    expect(sameLayerKey({ ...key, editingTextId: 't1' }, key)).toBe(false)
  })
})
