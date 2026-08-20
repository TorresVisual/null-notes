import { describe, it, expect } from 'vitest'
import { findSrCardSpans } from './srCards'

describe('findSrCardSpans', () => {
  it('finds a whole-text Q::A span', () => {
    const text = 'What is Big-O of binary search? :: O(log n)'
    const spans = findSrCardSpans(text)
    expect(spans).toEqual([{ kind: 'qa', from: 0, to: text.length }])
  })

  it('finds a cloze span covering the whole text', () => {
    const text = 'A binary search tree keeps {{all left descendants smaller}} than the node.'
    const spans = findSrCardSpans(text)
    expect(spans).toEqual([{ kind: 'cloze', from: 0, to: text.length }])
  })

  it('does not match plain prose', () => {
    expect(findSrCardSpans('Just an ordinary sentence.')).toEqual([])
  })

  it('does not match a schedule comment line', () => {
    expect(
      findSrCardSpans('<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->'),
    ).toEqual([])
  })

  it('prefers qa over cloze when a line could read as both', () => {
    const text = 'Q :: {{A}}'
    const spans = findSrCardSpans(text)
    expect(spans).toEqual([{ kind: 'qa', from: 0, to: text.length }])
  })
})
