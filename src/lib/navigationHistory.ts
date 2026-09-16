import { create } from 'zustand'
import { useWorkspaceStore } from '../store/workspace'
import { recallPosition } from './notePositions'

/**
 * Back/forward navigation history, browser/Notion-style: every note switch
 * — sidebar click, tab click, wiki-link, search result — is tracked, not
 * just link-driven jumps. Session-only, like `notePositions.ts`: cleared on
 * workspace switch (see `useWorkspace.ts`), never persisted.
 *
 * The back/forward stacks stay plain arrays, like `notePositions.ts` — only
 * `canGoBack`/`canGoForward` need to drive a re-render (for the TabBar
 * buttons), so `useNavigationHistoryStore` just mirrors those two booleans.
 */

interface HistoryEntry {
  notePath: string
  scrollFraction: number
}

const back: HistoryEntry[] = []
const forward: HistoryEntry[] = []

export const useNavigationHistoryStore = create<{ canGoBack: boolean; canGoForward: boolean }>(
  () => ({ canGoBack: false, canGoForward: false })
)

function syncStore(): void {
  useNavigationHistoryStore.setState({ canGoBack: back.length > 0, canGoForward: forward.length > 0 })
}

function entryFor(notePath: string): HistoryEntry {
  return { notePath, scrollFraction: recallPosition(notePath)?.scrollFraction ?? 0 }
}

// True while goBack/goForward is switching the active tab itself — the
// activeTab subscriber below must not record that as a new navigation, or
// every step back would immediately push a step forward onto `back`.
let restoring = false

useWorkspaceStore.subscribe((state, prevState) => {
  if (restoring) return
  if (state.activeTab === prevState.activeTab) return
  if (!prevState.activeTab) return
  back.push(entryFor(prevState.activeTab))
  forward.length = 0
  syncStore()
})

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
  restoring = true
  useWorkspaceStore.getState().openTab(entry.notePath)
  restoring = false
  scrollToOffset(entry.scrollFraction)
}

export function goBack(): void {
  const entry = back.pop()
  if (!entry) return
  const here = useWorkspaceStore.getState().activeTab
  if (here) forward.push(entryFor(here))
  restoreEntry(entry)
  syncStore()
}

export function goForward(): void {
  const entry = forward.pop()
  if (!entry) return
  const here = useWorkspaceStore.getState().activeTab
  if (here) back.push(entryFor(here))
  restoreEntry(entry)
  syncStore()
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
  syncStore()
}
