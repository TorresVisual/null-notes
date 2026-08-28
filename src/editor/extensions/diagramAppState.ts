import type { AppState } from '@excalidraw/excalidraw/types'

// Only this small, well-established subset (matching Excalidraw's own
// documented .excalidraw JSON schema) is ever persisted. AppState's other
// ~80 live fields include things like `collaborators` (a Map) that
// JSON.stringify silently degrades to a plain object — feeding that back
// into a fresh <Excalidraw initialData> mount crashes with an uncaught
// "collaborators.forEach is not a function", and with no error boundary
// above it, that took down the entire app, not just this block.
//
// Kept in its own module, separate from DiagramEditorOverlay.tsx, purely so
// tests can exercise it without pulling in @excalidraw/excalidraw's runtime
// — this file only imports AppState's type, which is erased at compile
// time and costs nothing at runtime.
export interface PersistedAppState {
  viewBackgroundColor?: AppState['viewBackgroundColor']
  gridSize?: AppState['gridSize']
}

export function toPersistedAppState(appState: AppState): PersistedAppState {
  return { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize }
}

// The counterpart for reading a stored scene back in. `JSON.parse(json) as
// StoredScene` is a compile-time assertion only — it does not strip
// anything a file actually contains, so a diagram saved before
// toPersistedAppState existed (or edited by hand, or written by a future
// version of this app) can still carry a full, corrupted AppState on disk.
// Read-side sanitization is what makes those files self-heal on next open,
// rather than crashing every time they're reopened.
export function sanitizePersistedAppState(raw: unknown): PersistedAppState {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const result: PersistedAppState = {}
  if (typeof obj.viewBackgroundColor === 'string') result.viewBackgroundColor = obj.viewBackgroundColor
  if (typeof obj.gridSize === 'number' || obj.gridSize === null) result.gridSize = obj.gridSize as AppState['gridSize']
  return result
}
