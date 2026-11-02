import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { rectFromPoints } from '../lib/occlusion'
import type { OcclusionRect, Point } from '../lib/occlusion'

// Drag-to-draw rectangles over a surface that wraps an image tightly. Points
// are fractions of the surface, so the result needs no knowledge of how large
// the image happens to be drawn.
export function useRegionDrawing() {
  const [rects, setRects] = useState<OcclusionRect[]>([])
  const [draft, setDraft] = useState<OcclusionRect | null>(null)
  const anchor = useRef<Point | null>(null)

  function pointAt(event: PointerEvent<HTMLElement>): Point {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }

  const handlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      event.currentTarget.setPointerCapture(event.pointerId)
      anchor.current = pointAt(event)
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (anchor.current) setDraft(rectFromPoints(anchor.current, pointAt(event)))
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      if (!anchor.current) return
      const rect = rectFromPoints(anchor.current, pointAt(event))
      if (rect) setRects((current) => [...current, rect])
      anchor.current = null
      setDraft(null)
    },
  }

  function remove(index: number) {
    setRects((current) => current.filter((_, i) => i !== index))
  }

  return { rects, draft, handlers, remove }
}
