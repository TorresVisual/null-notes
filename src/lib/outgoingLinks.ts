import { splitFrontmatter } from './frontmatter'
import { isExternalHref, resolveNoteLink } from './noteLinks'
import { parseWikiLink } from './wikiLinkSyntax'
import type { NoteMetadata } from '../types'

export interface ResolvedLink {
  key: string
  // More than one entry means the title is shared (#122) and the wiki-link is ambiguous.
  candidates: NoteMetadata[]
  count: number
}

export interface UnresolvedLink {
  key: string
  label: string
  title: string
  // Where a Markdown target belongs; unset for wiki-links, which create where `[[` does.
  folder?: string
  // The target would land outside the linking note's folder tree, so it is never created.
  blocked?: boolean
  count: number
}

export interface PossibleLink {
  title: string
  candidates: NoteMetadata[]
  count: number
}

export interface OutgoingLinks {
  links: ResolvedLink[]
  unresolved: UnresolvedLink[]
  possible: PossibleLink[]
}

const MIN_POSSIBLE_TITLE_CHARS = 3
const WIKI_LINK = /\[\[([^\]\n]+)\]\]/g
const MARKDOWN_LINK = /(?<!!)\[[^\]\n]*\]\(([^)\n]+)\)/g
const NOT_PROSE = /```[\s\S]*?```|`[^`\n]*`/g

function safeDecode(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function bump<T extends { count: number }>(map: Map<string, T>, key: string, make: () => T): void {
  const entry = map.get(key)
  if (entry) entry.count++
  else map.set(key, make())
}

export function analyseOutgoingLinks(
  content: string,
  notePath: string,
  workspace: string,
  notes: readonly NoteMetadata[],
): OutgoingLinks {
  const prose = splitFrontmatter(content).body.replace(NOT_PROSE, '')
  const byTitle = new Map<string, NoteMetadata[]>()
  for (const note of notes) {
    const key = note.title.toLowerCase()
    byTitle.set(key, [...(byTitle.get(key) ?? []), note])
  }
  const paths = notes.map((n) => n.path)
  const noteDir = notePath.replace(/[\\/][^\\/]*$/, '')

  const links = new Map<string, ResolvedLink>()
  const unresolved = new Map<string, UnresolvedLink>()
  const linkedTitles = new Set<string>()
  const linkedPaths = new Set<string>()

  function addResolved(candidates: NoteMetadata[]): void {
    const [only] = candidates
    const key = candidates.length === 1 && only ? only.path : `title:${only?.title.toLowerCase()}`
    for (const c of candidates) linkedPaths.add(c.path)
    bump(links, key, () => ({ key, candidates, count: 1 }))
  }

  for (const [, body = ''] of prose.matchAll(WIKI_LINK)) {
    const { title } = parseWikiLink(body)
    if (!title) continue
    const candidates = byTitle.get(title.toLowerCase())
    linkedTitles.add(title.toLowerCase())
    if (candidates) addResolved(candidates)
    else bump(unresolved, `wiki:${title.toLowerCase()}`, () => ({ key: `wiki:${title.toLowerCase()}`, label: title, title, count: 1 }))
  }

  for (const [, rawHref = ''] of prose.matchAll(MARKDOWN_LINK)) {
    const href = rawHref.trim().split(/\s+/)[0] ?? ''
    const target = safeDecode(href.split(/[?#]/)[0] ?? '')
    if (isExternalHref(href) || !/\.md$/i.test(target)) continue

    const hit = resolveNoteLink(href, notePath, workspace, paths)
    const resolved = notes.find((n) => n.path === hit)
    if (resolved) {
      addResolved([resolved])
      continue
    }
    const parts = target.replace(/\\/g, '/').split('/')
    const file = parts.pop() ?? ''
    const escapes = parts.some((p) => p === '..' || p === '')
    const key = `md:${target.toLowerCase()}`
    bump(unresolved, key, () => ({
      key,
      label: target,
      title: file.replace(/\.md$/i, ''),
      folder: [noteDir, ...parts.filter((p) => p !== '.')].join('/'),
      blocked: escapes,
      count: 1,
    }))
  }

  const ownTitle = notes.find((n) => n.path === notePath)?.title.toLowerCase()
  const text = prose.replace(WIKI_LINK, '').replace(MARKDOWN_LINK, '')
  const lowerText = text.toLowerCase()
  const possible: PossibleLink[] = []
  for (const [key, candidates] of byTitle) {
    const title = candidates[0]?.title ?? ''
    if (
      key === ownTitle ||
      key.length < MIN_POSSIBLE_TITLE_CHARS ||
      !lowerText.includes(key) ||
      linkedTitles.has(key) ||
      candidates.some((c) => linkedPaths.has(c.path))
    ) {
      continue
    }
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const count = text.match(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu'))?.length ?? 0
    if (count > 0) possible.push({ title, candidates, count })
  }

  return { links: [...links.values()], unresolved: [...unresolved.values()], possible }
}
