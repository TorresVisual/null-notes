import type { InkData } from './types'

// Every edit allocates a new InkData (commit, undo, redo, erase, lasso move all
// go through setInkData), so object identity is a complete "did the committed
// ink change" test — no deep comparison, and no way to forget a mutation path.
export interface LayerKey {
  inkData: InkData
  scale: number
  editingTextId: string | null
}

export function sameLayerKey(cached: LayerKey | null, next: LayerKey): boolean {
  return (
    cached !== null &&
    cached.inkData === next.inkData &&
    cached.scale === next.scale &&
    cached.editingTextId === next.editingTextId
  )
}
