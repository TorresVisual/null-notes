import { describe, it, expect } from 'vitest'
import { formatWikiLink, parseWikiLink, wikiLinkText } from './wikiLinkSyntax'

describe('wikiLinkSyntax', () => {
  it.each([
    ['Note', { title: 'Note', heading: '', label: '' }],
    ['Note|shown', { title: 'Note', heading: '', label: 'shown' }],
    ['Note#Heading', { title: 'Note', heading: 'Heading', label: '' }],
    ['Note#Heading|shown', { title: 'Note', heading: 'Heading', label: 'shown' }],
    ['Note|a#b', { title: 'Note', heading: '', label: 'a#b' }],
  ])('parses %s and round-trips', (body, parts) => {
    expect(parseWikiLink(body)).toEqual(parts)
    expect(formatWikiLink(parts)).toBe(body)
  })

  it('shows the label, else "Note › Heading", else the title', () => {
    expect(wikiLinkText({ title: 'N', heading: 'H', label: 'x' })).toBe('x')
    expect(wikiLinkText({ title: 'N', heading: 'H', label: '' })).toBe('N › H')
    expect(wikiLinkText({ title: 'N', heading: '', label: '' })).toBe('N')
  })
})
