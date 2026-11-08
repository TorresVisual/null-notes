import type { SplitSide } from './editorGroups'

export type DropZone = SplitSide | 'center'

// Set by the tab strip so a drop can tell a dragged tab from dragged text,
// which also carries text/plain.
export const TAB_DRAG_MIME = 'application/x-nullnotes-tab'

const EDGE_SHARE = 0.25

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

// Edge zones only exist while there is one group to split; with two, every
// drop lands in a group.
export function dropZoneAt(rect: Rect, x: number, y: number, groupCount: number): DropZone {
  if (groupCount > 1 || rect.width <= 0 || rect.height <= 0) return 'center'
  const fx = (x - rect.left) / rect.width
  const fy = (y - rect.top) / rect.height
  const nearest: [number, SplitSide][] = [
    [fx, 'left'],
    [1 - fx, 'right'],
    [fy, 'up'],
    [1 - fy, 'down'],
  ]
  const [distance, side] = nearest.reduce((a, b) => (b[0] < a[0] ? b : a))
  return distance < EDGE_SHARE ? side : 'center'
}
