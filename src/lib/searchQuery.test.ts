import { describe, it, expect } from 'vitest'
import { parseSearchQuery } from './searchQuery'

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
