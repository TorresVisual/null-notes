import { describe, it, expect } from 'vitest'
import { firstPositiveTerm, parseSearchQuery } from './searchQuery'

describe('parseSearchQuery', () => {
  it('parses free text with no keys', () => {
    expect(parseSearchQuery('shortest path')).toEqual({
      text: 'shortest path',
      folder: null,
      tag: null,
      type: null,
    })
  })

  it('extracts a folder key', () => {
    expect(parseSearchQuery('folder:CS101 shortest path')).toEqual({
      text: 'shortest path',
      folder: 'CS101',
      tag: null,
      type: null,
    })
  })

  it('extracts a tag key', () => {
    expect(parseSearchQuery('tag:graphs')).toEqual({ text: '', folder: null, tag: 'graphs', type: null })
  })

  it('extracts a type key', () => {
    expect(parseSearchQuery('type:theorem')).toEqual({ text: '', folder: null, tag: null, type: 'theorem' })
  })

  it('combines several keys with free text, in any order', () => {
    expect(parseSearchQuery('shortest tag:graphs folder:CS101 path')).toEqual({
      text: 'shortest path',
      folder: 'CS101',
      tag: 'graphs',
      type: null,
    })
  })

  it('is case-insensitive on the key name', () => {
    expect(parseSearchQuery('TAG:graphs')).toEqual({ text: '', folder: null, tag: 'graphs', type: null })
  })

  it('the last occurrence of a repeated key wins', () => {
    expect(parseSearchQuery('folder:CS101 folder:CS102')).toEqual({
      text: '',
      folder: 'CS102',
      tag: null,
      type: null,
    })
  })

  it('collapses extra whitespace left behind by stripped keys', () => {
    expect(parseSearchQuery('  tag:graphs   shortest  ')).toEqual({
      text: 'shortest',
      folder: null,
      tag: 'graphs',
      type: null,
    })
  })

  it('ignores an unrecognised key, treating it as free text', () => {
    expect(parseSearchQuery('author:knuth shortest')).toEqual({
      text: 'author:knuth shortest',
      folder: null,
      tag: null,
      type: null,
    })
  })
})

describe('parseSearchQuery with operators', () => {
  it('leaves phrase, OR, exclusion and grouping in the free text', () => {
    expect(parseSearchQuery('folder:CS101 "master theorem" OR (a -b) tag:x')).toEqual({
      text: '"master theorem" OR (a -b)',
      folder: 'CS101',
      tag: 'x',
      type: null,
    })
  })
})

describe('firstPositiveTerm', () => {
  it('returns a bare word', () => {
    expect(firstPositiveTerm('shortest path')).toBe('shortest')
  })

  it('returns a whole quoted phrase', () => {
    expect(firstPositiveTerm('"master theorem" OR recurrence')).toBe('master theorem')
  })

  it('skips exclusions, OR and grouping', () => {
    expect(firstPositiveTerm('-heap OR (tree)')).toBe('tree')
    expect(firstPositiveTerm('-"max heap" OR sort')).toBe('sort')
  })

  it('degrades on unbalanced quotes', () => {
    expect(firstPositiveTerm('"open phrase')).toBe('open')
  })

  it('returns undefined when nothing is wanted', () => {
    expect(firstPositiveTerm('-heap')).toBeUndefined()
    expect(firstPositiveTerm('')).toBeUndefined()
  })
})
