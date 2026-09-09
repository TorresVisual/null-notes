export interface NotePosition {
  // Both stored as a 0..1 fraction through the document rather than an
  // absolute character offset or pixel: the rendered and raw views lay the
  // same note out completely differently, so a fraction is the only unit
  // that means the same thing in both. Restoring within the same view still
  // lands exactly (the fraction round-trips against the same content), and
  // switching views lands at the closest equivalent spot instead of
  // whatever the other view's absolute offset happened to be.
  cursorFraction: number
  scrollFraction: number
}

// Session-scoped, deliberately not persisted: where the cursor sat is not note
// content, and .workspace.json already carries the state that is worth keeping
// across restarts (open tabs, expanded folders).
const positions = new Map<string, NotePosition>()

const EMPTY: NotePosition = { cursorFraction: 0, scrollFraction: 0 }

export function rememberPosition(path: string, patch: Partial<NotePosition>): void {
  positions.set(path, { ...(positions.get(path) ?? EMPTY), ...patch })
}

export function recallPosition(path: string): NotePosition | undefined {
  return positions.get(path)
}

export function forgetPosition(path: string): void {
  positions.delete(path)
}
