import { describe, it, expect } from 'vitest'
import { isBareNoteName, isExternalHref, resolveNoteLink } from './noteLinks'

const ws = 'C:\\ws'
const notes = ['C:\\ws\\Link.md', 'C:\\ws\\sub\\Lecture 7.md', 'C:\\ws\\sub\\Other.md']

describe('isBareNoteName', () => {
  it('flags .md names so they are not autolinked as Moldovan domains', () => {
    expect(isBareNoteName('Link.md')).toBe(true)
    expect(isBareNoteName('sub/Note.MD#top')).toBe(true)
    expect(isBareNoteName('example.com')).toBe(false)
    expect(isBareNoteName('https://example.md')).toBe(false)
  })
})

describe('isExternalHref', () => {
  it('treats anything with a scheme as external', () => {
    expect(isExternalHref('https://a.b')).toBe(true)
    expect(isExternalHref('mailto:a@b.c')).toBe(true)
    expect(isExternalHref('Link.md')).toBe(false)
  })
})

describe('resolveNoteLink', () => {
  it('resolves relative to the linking note, then the workspace root', () => {
    expect(resolveNoteLink('Other.md', 'C:\\ws\\sub\\A.md', ws, notes)).toBe('C:\\ws\\sub\\Other.md')
    expect(resolveNoteLink('../Link.md', 'C:\\ws\\sub\\A.md', ws, notes)).toBe('C:\\ws\\Link.md')
    expect(resolveNoteLink('Link.md', 'C:\\ws\\sub\\A.md', ws, notes)).toBe('C:\\ws\\Link.md')
  })

  it('decodes %20 and ignores fragments and case', () => {
    expect(resolveNoteLink('lecture%207.md#intro', 'C:\\ws\\sub\\A.md', ws, notes)).toBe(
      'C:\\ws\\sub\\Lecture 7.md',
    )
  })

  it('returns null for a missing note', () => {
    expect(resolveNoteLink('Nope.md', 'C:\\ws\\A.md', ws, notes)).toBeNull()
  })
})
