export type MobileTab = 'home' | 'notes'
export type BackAction = 'close-overlay' | 'close-sheet' | 'close-editor' | 'go-home' | 'exit'

export interface BackState {
  overlayOpen: boolean
  sheetOpen: boolean
  editorOpen: boolean
  tab: MobileTab
}

export function resolveBack(s: BackState): BackAction {
  if (s.overlayOpen) return 'close-overlay'
  if (s.sheetOpen) return 'close-sheet'
  if (s.editorOpen) return 'close-editor'
  if (s.tab !== 'home') return 'go-home'
  return 'exit'
}
