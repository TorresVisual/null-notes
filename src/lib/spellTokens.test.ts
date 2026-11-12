import { describe, it, expect } from 'vitest'
import { normaliseLanguage, spellTokens } from './spellTokens'

const words = (text: string) => spellTokens(text).map((t) => t.word)

describe('spellTokens', () => {
  it('yields plain words with their offsets', () => {
    expect(spellTokens('Ein Haus')).toEqual([
      { start: 0, end: 3, word: 'Ein' },
      { start: 4, end: 8, word: 'Haus' },
    ])
  })

  it('keeps umlauts and inner apostrophes in one word', () => {
    expect(words('Prüfung don’t it\'s')).toEqual(['Prüfung', 'don’t', "it's"])
  })

  it('skips identifiers, paths, URLs and acronyms', () => {
    const text = 'camelCase snake_case std::cout main.cpp src/lib https://example.com NASA var1 a->b printf(x) @user'
    expect(words(text)).toEqual([])
  })

  it('still flags ordinary words next to punctuation', () => {
    expect(words('Hello, (wrold). Ende!')).toEqual(['Hello', 'wrold', 'Ende'])
  })

  it('drops single letters', () => {
    expect(words('a x I')).toEqual([])
  })
})

describe('normaliseLanguage', () => {
  it('folds regional tags to the shipped dictionaries', () => {
    expect(normaliseLanguage('de-AT')).toBe('de')
    expect(normaliseLanguage('EN_gb')).toBe('en')
    expect(normaliseLanguage('fr')).toBeUndefined()
    expect(normaliseLanguage(42)).toBeUndefined()
  })
})
