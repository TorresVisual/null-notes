export const RUNNABLE_LANGUAGES = new Set(['python', 'cpp', 'c++', 'c'])

export interface RunEntry {
  runId: string
  status: 'starting' | 'running' | 'exited' | 'timeout' | 'stopped'
  exitCode: number | null
  output: { stream: 'stdout' | 'stderr'; text: string }[]
}

export type CodeRunMeta =
  | { type: 'start'; pos: number; runId: string }
  | { type: 'output'; runId: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'exit'; runId: string; code: number | null }
  | { type: 'timeout'; runId: string }
  | { type: 'stopped'; runId: string }
  | { type: 'close'; pos: number }

function posForRunId(entries: Map<number, RunEntry>, runId: string): number | null {
  for (const [pos, entry] of entries) {
    if (entry.runId === runId) return pos
  }
  return null
}

/**
 * Pure reducer backing `CodeBlockRun`'s ProseMirror plugin state — kept
 * separate from the plugin itself so the transition logic is unit-testable
 * without mounting an editor, the same split `CodeBlockSearch.ts`'s
 * `findMatches` makes.
 */
export function applyCodeRunMeta(entries: Map<number, RunEntry>, meta: CodeRunMeta): Map<number, RunEntry> {
  if (meta.type === 'start') {
    const next = new Map(entries)
    next.set(meta.pos, { runId: meta.runId, status: 'starting', exitCode: null, output: [] })
    return next
  }

  if (meta.type === 'close') {
    if (!entries.has(meta.pos)) return entries
    const next = new Map(entries)
    next.delete(meta.pos)
    return next
  }

  const pos = posForRunId(entries, meta.runId)
  if (pos === null) return entries
  // Non-null: `pos` came from `posForRunId`, which only ever returns a key
  // that exists in `entries`.
  const entry = entries.get(pos)!

  if (meta.type === 'output') {
    const next = new Map(entries)
    next.set(pos, {
      ...entry,
      status: entry.status === 'starting' ? 'running' : entry.status,
      output: [...entry.output, { stream: meta.stream, text: meta.text }],
    })
    return next
  }

  if (meta.type === 'exit') {
    const next = new Map(entries)
    next.set(pos, { ...entry, status: 'exited', exitCode: meta.code })
    return next
  }

  if (meta.type === 'timeout') {
    const next = new Map(entries)
    next.set(pos, { ...entry, status: 'timeout' })
    return next
  }

  // 'stopped'
  const next = new Map(entries)
  next.set(pos, { ...entry, status: 'stopped' })
  return next
}

/** Base64 (as emitted by `commands::code_run::emit_output`) to a UTF-8 string. */
export function decodeBase64Text(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
