const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function isExternalHref(href: string): boolean {
  return SCHEME.test(href)
}

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

// A note's content is untrusted (synced, imported, pasted), so only these
// schemes may reach the OS opener — never `file:`, `javascript:` or custom handlers.
export function isSafeExternalHref(href: string): boolean {
  try {
    return SAFE_SCHEMES.has(new URL(href).protocol.toLowerCase())
  } catch {
    return false
  }
}

// `.md` is Moldova's TLD, so linkify reads a bare `Link.md` as a domain.
export function isBareNoteName(text: string): boolean {
  return !SCHEME.test(text) && /\.md$/i.test(text.split(/[?#]/)[0] ?? '')
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join('/')
}

/**
 * The note a relative Markdown link points at: first relative to the linking
 * note's folder, then relative to the workspace root. Comparison is
 * case-insensitive because the app is Windows-primary.
 */
export function resolveNoteLink(
  href: string,
  notePath: string,
  workspace: string,
  notePaths: readonly string[],
): string | null {
  const target = safeDecode(href.split(/[?#]/)[0] ?? '')
  if (!target) return null

  const noteDir = notePath.replace(/[\\/][^\\/]*$/, '')
  const candidates = [
    normalize(`${noteDir}/${target}`),
    normalize(`${workspace}/${target.replace(/^[\\/]+/, '')}`),
  ].map((candidate) => candidate.toLowerCase())

  for (const candidate of candidates) {
    const hit = notePaths.find((p) => normalize(p).toLowerCase() === candidate)
    if (hit) return hit
  }
  return null
}

/** The destination to write in `from`'s Markdown to reach `to`: `Link.md`, `sub/Other.md`, `../Up.md`. */
export function relativeNoteLink(from: string, to: string): string {
  const fromDir = normalize(from).split('/').slice(0, -1)
  const toParts = normalize(to).split('/')
  let shared = 0
  while (
    shared < fromDir.length &&
    shared < toParts.length - 1 &&
    fromDir[shared]?.toLowerCase() === toParts[shared]?.toLowerCase()
  ) {
    shared++
  }
  return [...fromDir.slice(shared).map(() => '..'), ...toParts.slice(shared)].join('/')
}
