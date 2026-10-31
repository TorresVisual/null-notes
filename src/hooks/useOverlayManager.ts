import { useCallback, useEffect, useState } from 'react'

export type OverlayKind =
  | 'search'
  | 'switcher'
  | 'settings'
  | 'shortcuts'
  | 'template'
  | 'graph'
  | 'task'
  | 'review'
  | 'formulaSheet'
  | 'exportPdf'
  | 'print'
  | 'flashcard'
  | 'diagramPicker'
  | 'deck'
  | 'trash'

/**
 * One overlay open at a time, by construction: opening a new one always
 * replaces whichever was active, and Escape always closes whichever is
 * active — a single mechanism standing in for what used to be nine
 * independent booleans in Layout.tsx with no shared rule between them.
 */
export function useOverlayManager() {
  const [activeOverlay, setActiveOverlay] = useState<OverlayKind | null>(null)

  const openOverlay = useCallback((kind: OverlayKind) => setActiveOverlay(kind), [])
  const closeOverlay = useCallback(() => setActiveOverlay(null), [])

  useEffect(() => {
    if (!activeOverlay) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeOverlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeOverlay, closeOverlay])

  return { activeOverlay, openOverlay, closeOverlay }
}
