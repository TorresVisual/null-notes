import type { NoteMetadata } from '../types'

// Which note a `[[target]]` names. Mirrors src-tauri/src/link_resolve.rs — the
// editor, graph, backlinks and rename must all agree, so change both together.
// A target holding `/` is a path suffix (`Course/Sheet 01`); anything else is a
// title. Several matches resolve to the shallowest path, then the
// alphabetically first.

function stemKey(path: string): string {
  const p = path.replace(/\\/g, '/').toLowerCase()
  return p.endsWith('.md') ? p.slice(0, -3) : p
}

function normalizeTarget(target: string): string {
  return target.trim().replace(/\\/g, '/').toLowerCase().replace(/^\/+|\/+$/g, '')
}

function matchesTarget(t: string, note: NoteMetadata): boolean {
  if (t.includes('/')) {
    const key = stemKey(note.path)
    if (key === t || key.endsWith(`/${t}`)) return true
  }
  return note.title.toLowerCase() === t
}

function compareDepth(a: NoteMetadata, b: NoteMetadata): number {
  if (a.path.length !== b.path.length) return a.path.length - b.path.length
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

export function resolveWikiLink(target: string, notes: NoteMetadata[]): NoteMetadata | undefined {
  const t = normalizeTarget(target)
  let best: NoteMetadata | undefined
  for (const note of notes) {
    if (matchesTarget(t, note) && (!best || compareDepth(note, best) < 0)) best = note
  }
  return best
}

// What `[[` autocomplete should write for `note`: its bare title, unless another
// note shares it — then the shortest trailing path that names only this note.
export function wikiLinkTargetFor(note: NoteMetadata, notes: NoteMetadata[]): string {
  const title = note.title.toLowerCase()
  if (!notes.some((n) => n.path !== note.path && n.title.toLowerCase() === title)) return note.title

  const segments = stemKey(note.path).split('/')
  const original = note.path.replace(/\\/g, '/').replace(/\.md$/i, '').split('/')
  for (let k = 2; k < segments.length; k++) {
    const candidate = segments.slice(-k).join('/')
    if (notes.filter((n) => matchesTarget(candidate, n)).length === 1) {
      return original.slice(-k).join('/')
    }
  }
  return original.join('/')
}
