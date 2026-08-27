import { describe, it, expect } from 'vitest'
import { nextFootnoteLabel } from './footnotes'

describe('nextFootnoteLabel', () => {
  it('starts at 1 for a note with no footnotes yet', () => {
    expect(nextFootnoteLabel([])).toBe('1')
  })

  it('advances past the highest existing integer label', () => {
    expect(nextFootnoteLabel(['1', '2', '3'])).toBe('4')
  })

  it('is not confused by out-of-order labels', () => {
    expect(nextFootnoteLabel(['3', '1', '2'])).toBe('4')
  })

  it('ignores non-numeric labels entirely', () => {
    expect(nextFootnoteLabel(['note', 'aside'])).toBe('1')
  })

  it('mixes numeric and non-numeric labels correctly', () => {
    expect(nextFootnoteLabel(['note', '5', 'aside'])).toBe('6')
  })

  it('counts a label appearing on both a reference and its definition once', () => {
    expect(nextFootnoteLabel(['1', '1', '2', '2'])).toBe('3')
  })
})
