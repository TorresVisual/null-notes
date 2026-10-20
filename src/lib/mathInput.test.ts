import { describe, it, expect } from 'vitest'
import {
  activeCommandQuery,
  applyMathCommand,
  autoClose,
  backspacePair,
  matchMathCommands,
  nextSlot,
  typeCloser,
} from './mathInput'

describe('autoClose', () => {
  it('inserts the closing bracket and parks the cursor between the pair', () => {
    expect(autoClose('x^', 2, '{')).toEqual({ text: 'x^{}', cursor: 3 })
    expect(autoClose('f', 1, '(')).toEqual({ text: 'f()', cursor: 2 })
  })

  it('leaves an escaped bracket (\\{) alone', () => {
    expect(autoClose('\\', 1, '{')).toBeNull()
  })

  it('ignores keys that are not an opening bracket', () => {
    expect(autoClose('x', 1, 'a')).toBeNull()
    expect(autoClose('x', 1, '}')).toBeNull()
  })
})

describe('typeCloser', () => {
  it('overtypes a closer that is already next', () => {
    expect(typeCloser('x^{2}', 4, '}', false)).toEqual({ text: 'x^{2}', cursor: 5 })
  })

  it('does nothing when the next character is not that closer', () => {
    expect(typeCloser('x^{2', 4, '}', false)).toBeNull()
  })

  it('closes an environment on a new line in the block editor', () => {
    expect(typeCloser('\\begin{aligned}', 14, '}', true)).toEqual({
      text: '\\begin{aligned}\n\n\\end{aligned}',
      cursor: 16,
    })
  })

  it('closes an environment on one line for the inline input', () => {
    expect(typeCloser('\\begin{aligned}', 14, '}', false)).toEqual({
      text: '\\begin{aligned}  \\end{aligned}',
      cursor: 16,
    })
  })

  it('does not add a second \\end when the environment is already closed', () => {
    const text = '\\begin{aligned} a \\end{aligned}'
    expect(typeCloser(text, 14, '}', true)).toEqual({ text, cursor: 15 })
  })

  it('keeps starred environments intact', () => {
    expect(typeCloser('\\begin{align*}', 13, '}', true)?.text).toBe('\\begin{align*}\n\n\\end{align*}')
  })
})

describe('backspacePair', () => {
  it('deletes an empty pair together', () => {
    expect(backspacePair('x^{}', 3)).toEqual({ text: 'x^', cursor: 2 })
  })

  it('leaves a non-empty pair to the default Backspace', () => {
    expect(backspacePair('x^{2}', 3)).toBeNull()
  })
})

describe('nextSlot', () => {
  it('jumps out of the group and into the next one', () => {
    const text = '\\frac{a}{b}'
    expect(nextSlot(text, 7)).toBe(9)
  })

  it('jumps past the last group to just after its closer', () => {
    expect(nextSlot('\\frac{a}{b}', 10)).toBe(11)
  })

  it('works from an empty slot', () => {
    expect(nextSlot('\\frac{}{}', 6)).toBe(8)
  })

  it('skips over nested groups', () => {
    expect(nextSlot('\\sqrt{x^{2}+1}', 8)).toBe(14)
  })

  it('returns null outside any group', () => {
    expect(nextSlot('a + b', 2)).toBeNull()
  })

  it('does not treat \\{ as a group', () => {
    expect(nextSlot('\\{a\\}', 3)).toBeNull()
  })
})

describe('\\command completion', () => {
  it('finds the command being typed', () => {
    expect(activeCommandQuery('x + \\alp', 8)).toEqual({ start: 4, query: 'alp' })
  })

  it('waits for two letters', () => {
    expect(activeCommandQuery('\\a', 2)).toBeNull()
  })

  it('stops once the command is followed by something else', () => {
    expect(activeCommandQuery('\\alpha + ', 9)).toBeNull()
  })

  it('matches symbols by prefix, case-insensitively', () => {
    expect(matchMathCommands('alph').map((s) => s.latex)).toEqual(['\\alpha'])
    expect(matchMathCommands('gam').map((s) => s.latex)).toEqual(expect.arrayContaining(['\\gamma', '\\Gamma']))
  })

  it('returns nothing for an unknown prefix', () => {
    expect(matchMathCommands('zzzz')).toEqual([])
  })

  it('replaces the typed fragment with the full command', () => {
    expect(applyMathCommand('x + \\alp y', { start: 4, query: 'alp' }, 8, '\\alpha')).toEqual({
      text: 'x + \\alpha y',
      cursor: 10,
    })
  })
})
