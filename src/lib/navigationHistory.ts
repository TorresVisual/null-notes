import { useWorkspaceStore } from '../store/workspace'
import { recallPosition } from './notePositions'

/**
 * Back/forward navigation history for link-driven jumps (wiki-links,
 * cross-references) — not every tab switch, which is already its own
 * deliberate action. Session-only, like `notePositions.ts`: cleared on
 * workspace switch (see `useWorkspace.ts`), never persisted.
 *
 * A plain module rather than a Zustand store: nothing here needs to drive a
 * re-render on its own (Alt+Left/Right just call `goBack`/`goForward`
 * directly; there's no button UI to keep in sync), the same shape
 * `notePositions.ts` already uses for the same reason.
 */

interface HistoryEntry {
  notePath: string
  scrollFraction: number
}

const back: HistoryEntry[] = []
const forward: HistoryEntry[] = []

function currentLocation(): HistoryEntry | null {
  const notePath = useWorkspaceStore.getState().activeTab
  if (!notePath) return null
  return { notePath, scrollFraction: recallPosition(notePath)?.scrollFraction ?? 0 }
}

/** Scrolls `.editor-scroll` to `fraction` of its scrollable height, retrying
 *  across frames — after `openTab` switches to a different note, that
 *  note's content may not be mounted/sized yet. For a same-note jump the
 *  container already exists, so this resolves on the first attempt; it's
 *  the only path that actually moves the scroll position in that case,
 *  since `activeTab` not changing means the tab-switch scroll-restoration
 *  effect never re-fires. */
function scrollToOffset(fraction: number, attempt = 0): void {
  const el = document.querySelector<HTMLElement>('.editor-scroll')
  if (el) {
    const scrollable = el.scrollHeight - el.clientHeight
    el.scrollTop = scrollable > 0 ? fraction * scrollable : 0
    return
  }
  if (attempt < 90) requestAnimationFrame(() => scrollToOffset(fraction, attempt + 1))
}

function restoreEntry(entry: HistoryEntry): void {
  useWorkspaceStore.getState().openTab(entry.notePath)
  scrollToOffset(entry.scrollFraction)
}

/** Call immediately before navigating a link-driven jump — captures where
 *  the click happened so `goBack` can return to it. Clears the forward
 *  stack, matching a browser's "a new jump abandons old forward history." */
export function recordJumpFromHere(): void {
  const here = currentLocation()
  if (here) back.push(here)
  forward.length = 0
}

export function goBack(): void {
  const entry = back.pop()
  if (!entry) return
  const here = currentLocation()
  if (here) forward.push(here)
  restoreEntry(entry)
}

export function goForward(): void {
  const entry = forward.pop()
  if (!entry) return
  const here = currentLocation()
  if (here) back.push(here)
  restoreEntry(entry)
}

export function canGoBack(): boolean {
  return back.length > 0
}

export function canGoForward(): boolean {
  return forward.length > 0
}

export function clearNavigationHistory(): void {
  back.length = 0
  forward.length = 0
}
