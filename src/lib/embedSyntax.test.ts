import { describe, it, expect } from 'vitest'
import { embedBody, parseEmbedParagraph, sectionOf } from './embedSyntax'

describe('parseEmbedParagraph', () => {
  it('parses a lone embed with and without heading and label', () => {
    expect(parseEmbedParagraph('![[A]]')).toEqual({ title: 'A', heading: '', label: '' })
    expect(parseEmbedParagraph('  ![[A#H|x]] ')).toEqual({ title: 'A', heading: 'H', label: 'x' })
  })

  it.each(['see ![[A]]', '![[A]] more', '[[A]]', '![[A]] ![[B]]'])('rejects %s', (content) => {
    expect(parseEmbedParagraph(content)).toBeNull()
  })
})

describe('sectionOf', () => {
  it('runs from the heading to the next heading of the same or higher level', () => {
    expect(sectionOf('# T\n## A\nx\n### A1\ny\n## B\nz', 'a')).toBe('## A\nx\n### A1\ny')
  })

  it('runs to the end for the last section and is null when absent', () => {
    expect(sectionOf('## A\nx\n## B\nz', 'B')).toBe('## B\nz')
    expect(sectionOf('## A\nx', 'missing')).toBeNull()
  })

  it('ignores #-lines inside fenced code', () => {
    expect(sectionOf('## A\n```\n# not a heading\n```\nbody\n## B', 'A')).toBe(
      '## A\n```\n# not a heading\n```\nbody',
    )
    expect(sectionOf('```\n## A\n```\n## B', 'A')).toBeNull()
  })
})

describe('embedBody', () => {
  it('drops a leading H1 for a whole-note embed', () => {
    expect(embedBody('# T\nbody', '')).toBe('body')
    expect(embedBody('no h1\nbody', '')).toBe('no h1\nbody')
  })

  it('returns the section for a heading embed', () => {
    expect(embedBody('# T\n## P\nin\n## Q\nout', 'P')).toBe('## P\nin')
    expect(embedBody('# T', 'P')).toBeNull()
  })
})
