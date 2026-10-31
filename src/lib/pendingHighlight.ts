// A search result can be selected before its note's editor has mounted (or
// while it's already the active tab, in which case no mount ever happens) —
// this hands the requested text across that gap, same shape as
// notePositions.ts's remembered scroll offset. Consumed once: whichever of
// NoteEditor's two listeners (mount effect, or the already-mounted case's
// window event) gets there first clears it, so the other is a no-op.
// `heading` marks a wiki-link `[[Note#Heading]]` jump: the text is looked up
// among the note's headings rather than anywhere in its body.
export interface PendingHighlight {
  text: string
  heading: boolean
}

let pending: (PendingHighlight & { path: string }) | null = null

export function setPendingHighlight(path: string, text: string, heading = false): void {
  pending = { path, text, heading }
}

export function takePendingHighlight(path: string): PendingHighlight | undefined {
  if (!pending || pending.path !== path) return undefined
  const { text, heading } = pending
  pending = null
  return { text, heading }
}
