import { describe, it, expect } from 'vitest'
import { MATH_SYMBOL_CATEGORIES, filterMathSymbols } from './mathSymbols'

describe('filterMathSymbols', () => {
  it('returns every category for an empty query', () => {
    expect(filterMathSymbols('')).toEqual(MATH_SYMBOL_CATEGORIES)
  })

  it('matches by name, including a hit via the latex command itself', () => {
    const result = filterMathSymbols('arrow')
    expect(result).toHaveLength(1)
    const [arrows] = result
    if (!arrows) throw new Error('expected an Arrows category')
    expect(arrows.name).toBe('Arrows')
    // \Rightarrow/\Leftarrow/\Leftrightarrow also match on latex ("arrow"
    // substring), on top of the two whose display name says "arrow".
    expect(arrows.symbols.map((s) => s.name)).toEqual([
      'implies',
      'implied by',
      'if and only if',
      'up arrow',
      'down arrow',
    ])
  })

  it('matches by latex command', () => {
    const result = filterMathSymbols('\\leq')
    expect(result.flatMap((c) => c.symbols).map((s) => s.latex)).toEqual(['\\leq'])
  })

  it('drops a category entirely once none of its symbols match', () => {
    const result = filterMathSymbols('nothing matches this')
    expect(result).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(filterMathSymbols('ALPHA')).toEqual(filterMathSymbols('alpha'))
  })
})
