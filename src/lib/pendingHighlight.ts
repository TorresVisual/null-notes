// A search result can be selected before its note's editor has mounted (or
// while it's already the active tab, in which case no mount ever happens) —
// this hands the requested text across that gap, same shape as
// notePositions.ts's remembered scroll offset. Consumed once: whichever of
// NoteEditor's two listeners (mount effect, or the already-mounted case's
// window event) gets there first clears it, so the other is a no-op.
let pending: { path: string; text: string } | null = null

export function setPendingHighlight(path: string, text: string): void {
  pending = { path, text }
}

export function takePendingHighlight(path: string): string | undefined {
  if (!pending || pending.path !== path) return undefined
  const { text } = pending
  pending = null
  return text
}
