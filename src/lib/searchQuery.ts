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
