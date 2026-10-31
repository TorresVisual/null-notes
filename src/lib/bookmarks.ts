import { replacePathPrefix } from './pathPrefix'

interface BookmarkBase {
  group?: string
}
export interface NoteBookmark extends BookmarkBase {
  kind: 'note' | 'folder'
  path: string
}
export interface HeadingBookmark extends BookmarkBase {
  kind: 'heading'
  path: string
  heading: string
}
export interface SearchBookmark extends BookmarkBase {
  kind: 'search'
  query: string
}
export type Bookmark = NoteBookmark | HeadingBookmark | SearchBookmark

export interface BookmarkSection {
  group: string | null
  entries: { bookmark: Bookmark; index: number }[]
}

// In memory a path is absolute (so it rewrites with the same prefixes the tabs
// do); on disk it is workspace-relative with `/`, so the file means the same
// thing on every machine that clones the workspace.
function toRelative(path: string, workspace: string): string {
  return path.slice(workspace.length).replace(/\\/g, '/').replace(/^\/+/, '')
}

function toAbsolute(relative: string, workspace: string): string {
  const sep = workspace.includes('\\') ? '\\' : '/'
  return `${workspace}${sep}${relative.replace(/\//g, sep)}`
}

// One JSON object per line, in a fixed key order: Git merges two people's
// additions as two added lines, and a reorder touches only the lines that moved.
export function serializeBookmarks(items: Bookmark[], workspace: string): string {
  return items
    .map((b) => {
      const { kind, group } = b
      const line =
        b.kind === 'search'
          ? { kind, query: b.query, group }
          : b.kind === 'heading'
            ? { kind, path: toRelative(b.path, workspace), heading: b.heading, group }
            : { kind, path: toRelative(b.path, workspace), group }
      return JSON.stringify(line)
    })
    .map((line) => `${line}\n`)
    .join('')
}

// Unreadable lines are skipped rather than failing the whole file, so a
// half-resolved merge (conflict markers) still shows every bookmark that is intact.
export function parseBookmarks(text: string, workspace: string): Bookmark[] {
  const items: Bookmark[] = []
  for (const line of text.split('\n')) {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const group = typeof r.group === 'string' && r.group ? r.group : undefined
    if (r.kind === 'search' && typeof r.query === 'string') {
      items.push({ kind: 'search', query: r.query, group })
    } else if (typeof r.path === 'string' && r.path) {
      const path = toAbsolute(r.path, workspace)
      if (r.kind === 'note' || r.kind === 'folder') items.push({ kind: r.kind, path, group })
      else if (r.kind === 'heading' && typeof r.heading === 'string') {
        items.push({ kind: 'heading', path, heading: r.heading, group })
      }
    }
  }
  return items
}

export function sameBookmark(a: Bookmark, b: Bookmark): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'search') return b.kind === 'search' && a.query === b.query
  if (a.kind === 'heading') return b.kind === 'heading' && a.path === b.path && a.heading === b.heading
  return b.kind !== 'search' && a.path === b.path
}

export function rewriteBookmarkPrefix(items: Bookmark[], oldPrefix: string, newPrefix: string): Bookmark[] {
  let changed = false
  const next = items.map((b) => {
    if (b.kind === 'search') return b
    const path = replacePathPrefix(b.path, oldPrefix, newPrefix)
    if (path === b.path) return b
    changed = true
    return { ...b, path }
  })
  return changed ? next : items
}

// Ungrouped bookmarks first, then each group in order of its first member.
export function sectionBookmarks(items: Bookmark[]): BookmarkSection[] {
  const sections: BookmarkSection[] = []
  const ungrouped: BookmarkSection = { group: null, entries: [] }
  items.forEach((bookmark, index) => {
    if (!bookmark.group) return void ungrouped.entries.push({ bookmark, index })
    let section = sections.find((s) => s.group === bookmark.group)
    if (!section) sections.push((section = { group: bookmark.group, entries: [] }))
    section.entries.push({ bookmark, index })
  })
  return ungrouped.entries.length ? [ungrouped, ...sections] : sections
}

// Takes `from` out and puts it back before `before` (the index it had in the
// original list; `items.length` means the end), adopting `group`.
export function moveBookmark(items: Bookmark[], from: number, before: number, group: string | undefined): Bookmark[] {
  const moved = items[from]
  if (!moved) return items
  const rest = items.filter((_, i) => i !== from)
  const at = before > from ? before - 1 : before
  rest.splice(at, 0, { ...moved, group })
  return rest
}

export function bookmarkLabel(b: Bookmark, titleOf: (path: string) => string): string {
  switch (b.kind) {
    case 'search':
      return b.query
    case 'heading':
      return `${titleOf(b.path)} › ${b.heading}`
    default:
      return titleOf(b.path)
  }
}
