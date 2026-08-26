import { describe, it, expect } from 'vitest'
import { activeSlashQuery, applyMathSnippet, matchMathSnippets, MATH_SNIPPETS } from './mathSnippets'
import { renderMath } from './mathRender'

describe('activeSlashQuery', () => {
  it('finds a slash query at the cursor', () => {
    expect(activeSlashQuery('\\nabla f + /grad', 16)).toEqual({ start: 11, query: 'grad' })
  })

  it('finds a bare slash with an empty query', () => {
    expect(activeSlashQuery('/', 1)).toEqual({ start: 0, query: '' })
  })

  it('returns null when there is no slash before the cursor', () => {
    expect(activeSlashQuery('x^2 + y^2', 5)).toBeNull()
  })

  it('returns null once whitespace ends the query', () => {
    expect(activeSlashQuery('/grad x', 7)).toBeNull()
  })

  it('only looks at text before the cursor, not after it', () => {
    expect(activeSlashQuery('/grad rest', 5)).toEqual({ start: 0, query: 'grad' })
  })
})

describe('matchMathSnippets', () => {
  it('returns every snippet for an empty query', () => {
    expect(matchMathSnippets('')).toEqual(MATH_SNIPPETS)
  })

  it('matches by trigger prefix, case-insensitively', () => {
    const matches = matchMathSnippets('GRAD')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.trigger).toBe('gradient')
  })

  it('matches by description too', () => {
    const matches = matchMathSnippets('square')
    expect(matches.some((s) => s.trigger === 'sqrt')).toBe(true)
  })

  it('returns nothing for a query matching no snippet', () => {
    expect(matchMathSnippets('zzz-not-a-snippet')).toEqual([])
  })
})

describe('applyMathSnippet', () => {
  it('replaces the /query span with the snippet latex', () => {
    const snippet = { trigger: 'gradient', latex: '\\nabla f(x)', description: 'Gradient' }
    const result = applyMathSnippet('x = /grad', { start: 4, query: 'grad' }, 9, snippet)
    expect(result.text).toBe('x = \\nabla f(x)')
    expect(result.cursor).toBe(4 + snippet.latex.length)
  })

  it('leaves text after the cursor untouched', () => {
    const snippet = { trigger: 'sqrt', latex: '\\sqrt{x}', description: 'Square root' }
    const result = applyMathSnippet('/sq + 1', { start: 0, query: 'sq' }, 3, snippet)
    expect(result.text).toBe('\\sqrt{x} + 1')
  })
})

// P12-5: `\begin{aligned}`/`\begin{align}` already rendered correctly on
// their own — this pins that every *snippet's own* skeleton, aligned
// included, is a working equation the moment it lands, not just a plausible
// string, in both display and inline contexts (InlineMath's <input> can
// insert any snippet too).
describe('every snippet renders without a KaTeX error', () => {
  for (const snippet of MATH_SNIPPETS) {
    it(`/${snippet.trigger}`, () => {
      expect(renderMath(snippet.latex, true).error).toBeNull()
      expect(renderMath(snippet.latex, false).error).toBeNull()
    })
  }
})
