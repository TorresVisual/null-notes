import { api } from './tauri'
import type { SpellLanguage } from './spellTokens'

const verdicts: Record<SpellLanguage, Map<string, boolean>> = { de: new Map(), en: new Map() }

// A word already judged never crosses IPC again, so re-checking a note after an
// edit only sends the words that are new to this session.
// Resolves to the misspelled subset. A failed call (web build, backend not
// ready) yields none and caches nothing: no squiggles beat wrong ones.
export async function misspelledWords(lang: SpellLanguage, words: string[]): Promise<Set<string>> {
  const known = verdicts[lang]
  const unknown = [...new Set(words)].filter((word) => !known.has(word))
  if (unknown.length > 0) {
    try {
      const bad = new Set(await api.spell.check(lang, unknown))
      for (const word of unknown) known.set(word, bad.has(word))
    } catch {
      return new Set()
    }
  }
  return new Set(words.filter((word) => known.get(word)))
}

export async function spellSuggestions(lang: SpellLanguage, word: string): Promise<string[]> {
  try {
    return await api.spell.suggest(lang, word)
  } catch {
    return []
  }
}
