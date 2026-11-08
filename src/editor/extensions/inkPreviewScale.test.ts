import { describe, it, expect } from 'vitest'
import { previewScale, PREVIEW_MIN_SCALE } from './InkPreview'

describe('previewScale', () => {
  it('shrinks a moderate page to the height cap', () => {
    expect(previewScale(500)).toBeCloseTo(320 / 500)
  })

  it('never shows a page larger than life', () => {
    expect(previewScale(100)).toBe(1)
  })

  it('keeps a very tall page readable instead of shrinking to a sliver', () => {
    expect(previewScale(3000)).toBe(PREVIEW_MIN_SCALE)
  })
})
