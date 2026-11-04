import { describe, expect, it } from 'vitest'
import type { NoteMetadata } from '../types'
import { resolveWikiLink, wikiLinkTargetFor } from './wikiLinkResolve'

const note = (path: string, title: string): NoteMetadata => ({
  id: path,
  title,
  path,
  workspace: '/ws',
  updatedAt: 0,
})

const a = note('/ws/A/Sheet 01.md', 'Sheet 01')
const b = note('/ws/B/Sheet 01.md', 'Sheet 01')
const summary = note('/ws/B/Deep/Summary.md', 'Summary')
const notes = [b, a, summary]

describe('resolveWikiLink', () => {
  it('resolves a bare duplicate title the same way regardless of note order', () => {
    expect(resolveWikiLink('sheet 01', notes)).toBe(a)
    expect(resolveWikiLink('sheet 01', [a, b])).toBe(a)
  })

  it('resolves a qualified target to its own folder', () => {
    expect(resolveWikiLink('B/Sheet 01', notes)).toBe(b)
    expect(resolveWikiLink('Deep/Summary', notes)).toBe(summary)
  })

  it('requires the suffix to align on a path segment', () => {
    expect(resolveWikiLink('ep/Summary', notes)).toBeUndefined()
  })
})

describe('wikiLinkTargetFor', () => {
  it('keeps the bare title when it is unique', () => {
    expect(wikiLinkTargetFor(summary, notes)).toBe('Summary')
  })

  it('qualifies a duplicate title with the shortest unique path', () => {
    expect(wikiLinkTargetFor(b, notes)).toBe('B/Sheet 01')
    expect(resolveWikiLink(wikiLinkTargetFor(b, notes), notes)).toBe(b)
  })
})
