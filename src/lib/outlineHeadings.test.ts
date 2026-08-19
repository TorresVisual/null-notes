import { describe, it, expect } from 'vitest'
import { parseHeadings } from './outlineHeadings'

describe('parseHeadings', () => {
  it('returns nothing for a note with no headings', () => {
    expect(parseHeadings('just some prose\n\nmore prose')).toEqual([])
  })

  it('parses headings of every level, in document order', () => {
    const md = '# Title\n\nprose\n\n## Section\n\n### Subsection\n'
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Section' },
      { level: 3, text: 'Subsection' },
    ])
  })

  it('trims trailing whitespace from the heading text', () => {
    expect(parseHeadings('#   Spaced Out   \n')).toEqual([{ level: 1, text: 'Spaced Out' }])
  })

  it('ignores a heading-shaped line inside a fenced code block', () => {
    const md = '# Real Heading\n\n```\n# not a heading\n```\n'
    expect(parseHeadings(md)).toEqual([{ level: 1, text: 'Real Heading' }])
  })

  it('ignores a line with a # but no space before the text', () => {
    expect(parseHeadings('#NotAHeading\n')).toEqual([])
  })

  it('ignores a heading marker inside a blockquote/callout', () => {
    // ATX headings must start at column 0 per CommonMark; a `>`-prefixed
    // line is never one, callout markers included.
    expect(parseHeadings('> [!NOTE]\n> # Not a real heading\n')).toEqual([])
  })
})
