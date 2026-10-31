import { describe, expect, it } from 'vitest'
import { joinFrontmatter, splitFrontmatter } from './frontmatter'

const BLOCK = '---\ntitle: Foo\ntags: [a, b]\naliases:\n  - Bar\n---\n'

describe('splitFrontmatter', () => {
  it('separates the block verbatim from the body', () => {
    expect(splitFrontmatter(`${BLOCK}# Title\n`)).toEqual({ frontmatter: BLOCK, body: '# Title\n' })
  })

  it('handles an empty block', () => {
    expect(splitFrontmatter('---\n---\nbody')).toEqual({ frontmatter: '---\n---\n', body: 'body' })
  })

  it('does not close on --- inside a value', () => {
    const block = '---\nnote: a --- b\n---\n'
    expect(splitFrontmatter(`${block}body`)).toEqual({ frontmatter: block, body: 'body' })
  })

  it('returns no frontmatter for plain notes and unclosed blocks', () => {
    for (const note of ['# Title\n---\nx\n---\n', '---\nnever closed\n', '']) {
      expect(splitFrontmatter(note)).toEqual({ frontmatter: '', body: note })
    }
  })

  it('keeps CRLF line endings in the block', () => {
    const block = '---\r\ntitle: Foo\r\n---\r\n'
    expect(splitFrontmatter(`${block}body`)).toEqual({ frontmatter: block, body: 'body' })
  })
})

describe('joinFrontmatter', () => {
  it('round-trips split output byte for byte', () => {
    for (const note of [`${BLOCK}body\n`, '---\n---\n', '---\na: 1\n---', 'plain']) {
      const { frontmatter, body } = splitFrontmatter(note)
      expect(joinFrontmatter(frontmatter, body)).toBe(note)
    }
  })

  it('starts the body on its own line when the block ends the file without a newline', () => {
    expect(joinFrontmatter('---\na: 1\n---', 'new text')).toBe('---\na: 1\n---\nnew text')
  })
})
