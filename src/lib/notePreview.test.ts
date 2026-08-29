import { describe, it, expect } from 'vitest'
import { excerptForPreview } from './notePreview'

describe('excerptForPreview', () => {
  it('strips a leading heading line', () => {
    expect(excerptForPreview('# Dijkstra\nShortest paths with non-negative weights.')).toBe(
      'Shortest paths with non-negative weights.',
    )
  })

  it('collapses multiple lines into one', () => {
    expect(excerptForPreview('# Title\nFirst line.\nSecond line.')).toBe('First line. Second line.')
  })

  it('collapses blank lines between paragraphs without adding extra spaces', () => {
    expect(excerptForPreview('# Title\nFirst line.\n\nSecond line.')).toBe('First line. Second line.')
  })

  it('handles content with no heading', () => {
    expect(excerptForPreview('Just a paragraph, no heading.')).toBe('Just a paragraph, no heading.')
  })

  it('returns an empty string for a note with only a heading', () => {
    expect(excerptForPreview('# Title Only')).toBe('')
  })

  it('truncates long content with an ellipsis', () => {
    const long = 'x'.repeat(250)
    const result = excerptForPreview(`# Title\n${long}`, 200)
    expect(result.length).toBe(201)
    expect(result.endsWith('…')).toBe(true)
  })

  it('does not truncate content at or under the limit', () => {
    const exact = 'y'.repeat(200)
    expect(excerptForPreview(`# Title\n${exact}`, 200)).toBe(exact)
  })
})
