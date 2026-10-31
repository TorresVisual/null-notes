/**
 * P6-5: `folder:`/`tag:`/`type:` narrow a search without leaving the
 * keyboard — a fixed, small key list, not a query language (the bounded
 * version of "Dataview-lite" the roadmap otherwise rejects).
 *
 * `task:` is named in the roadmap too but deliberately not implemented here:
 * it needs P9-1's `note_tasks` table, which doesn't exist yet.
 */

export interface ParsedSearchQuery {
  /** Whatever free text remains once every recognised key is stripped out. */
  text: string
  folder: string | null
  tag: string | null
  type: string | null
}

// A value is one token, no spaces — deliberately no quoting syntax. This is
// meant to stay a fixed, small key list, not a query language.
const KEY_PATTERN = /\b(folder|tag|type):(\S+)/gi

export function parseSearchQuery(query: string): ParsedSearchQuery {
  let folder: string | null = null
  let tag: string | null = null
  let type: string | null = null

  const text = query
    .replace(KEY_PATTERN, (_match, key: string, value: string) => {
      switch (key.toLowerCase()) {
        case 'folder':
          folder = value
          break
        case 'tag':
          tag = value
          break
        case 'type':
          type = value
          break
      }
      return ' '
    })
    .replace(/\s+/g, ' ')
    .trim()

  return { text, folder, tag, type }
}

const TERM_PATTERN = /(-?)(?:"([^"]*)"|([^\s()"]+))/g

/** The first term a note has to contain: a quoted phrase or bare word that
 *  isn't excluded (`-x`) and isn't the `OR` operator. This is what a result
 *  jump scrolls to, since the whole query text (operators and all) won't be
 *  found in a note. */
export function firstPositiveTerm(text: string): string | undefined {
  for (const [, minus, phrase, word] of text.matchAll(TERM_PATTERN)) {
    const term = phrase ?? word
    if (!minus && term && (phrase !== undefined || term !== 'OR')) return term
  }
  return undefined
}
