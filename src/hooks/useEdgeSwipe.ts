import { useRef, type TouchEvent } from 'react'

export const EDGE_ZONE_PX = 24
export const SWIPE_DISTANCE_PX = 60

// Right edge only: Android's system back gesture owns the left edge. Fires on
// release, and only for a mostly-horizontal leftward drag that began in the
// edge zone, so ordinary scrolling never counts.
export function useEdgeSwipe(onSwipe: () => void, enabled: boolean) {
  const start = useRef<{ x: number; y: number } | null>(null)

  if (!enabled) return {}

  return {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      const t = e.touches[0]
      const inEdge = t !== undefined && e.touches.length === 1 && t.clientX >= window.innerWidth - EDGE_ZONE_PX
      start.current = inEdge ? { x: t.clientX, y: t.clientY } : null
    },
    onTouchEnd: (e: TouchEvent<HTMLElement>) => {
      const s = start.current
      const t = e.changedTouches[0]
      start.current = null
      if (!s || !t) return
      const dx = s.x - t.clientX
      if (dx >= SWIPE_DISTANCE_PX && dx >= 2 * Math.abs(t.clientY - s.y)) onSwipe()
    },
    onTouchCancel: () => {
      start.current = null
    },
  }
}
