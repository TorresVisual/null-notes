export interface SpellToken {
  start: number
  end: number
  word: string
}

export type SpellLanguage = 'de' | 'en'

// Folds 'de-AT', 'en-GB', 'DE' to the two dictionaries we ship; anything
// unrecognised is undefined so the caller can fall through to its default.
export function normaliseLanguage(tag: unknown): SpellLanguage | undefined {
  if (typeof tag !== 'string') return undefined
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0]
  return primary === 'de' || primary === 'en' ? primary : undefined
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu
// Characters that mean the letters next to them belong to a path, URL,
// handle or identifier rather than to prose.
const GLUE_BEFORE = /[_/\\@#$%]/
const GLUE_AFTER = /[_/\\@]/

// ponytail: a heuristic, not a parser. It errs toward not flagging, because a
// missed typo costs less than a squiggle under every identifier in a CS note.
function isProse(text: string, start: number, end: number): boolean {
  const word = text.slice(start, end)
  if (word.length < 2) return false
  if (/\p{Ll}\p{Lu}/u.test(word)) return false
  if (word === word.toUpperCase() && word !== word.toLowerCase()) return false
  const before = text[start - 1] ?? ''
  const after = text[end] ?? ''
  if (GLUE_BEFORE.test(before) || GLUE_AFTER.test(after)) return false
  if (/\d/.test(before) || /\d/.test(after)) return false
  if (before === ':' && text[start - 2] === ':') return false
  if (before === '.' && /[\p{L}\d]/u.test(text[start - 2] ?? '')) return false
  if (after === '.' && /[\p{L}\d]/u.test(text[end + 1] ?? '')) return false
  if (after === '(' || (after === ':' && text[end + 1] === ':')) return false
  if (after === '-' && text[end + 1] === '>') return false
  if (text.startsWith('://', end)) return false
  return true
}

export function spellTokens(text: string): SpellToken[] {
  const tokens: SpellToken[] = []
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (isProse(text, start, end)) tokens.push({ start, end, word: match[0] })
  }
  return tokens
}
