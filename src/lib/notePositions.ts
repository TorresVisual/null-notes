export interface NotePosition {
  selection: number
  scrollTop: number
  // Kept separate from scrollTop: the rendered and raw views lay the same
  // note out at very different heights, so one pixel offset can't serve both.
  rawScrollTop: number
}

// Session-scoped, deliberately not persisted: where the cursor sat is not note
// content, and .workspace.json already carries the state that is worth keeping
// across restarts (open tabs, expanded folders).
const positions = new Map<string, NotePosition>()

const EMPTY: NotePosition = { selection: 0, scrollTop: 0, rawScrollTop: 0 }

export function rememberPosition(path: string, patch: Partial<NotePosition>): void {
  positions.set(path, { ...(positions.get(path) ?? EMPTY), ...patch })
}

export function recallPosition(path: string): NotePosition | undefined {
  return positions.get(path)
}

export function forgetPosition(path: string): void {
  positions.delete(path)
}
