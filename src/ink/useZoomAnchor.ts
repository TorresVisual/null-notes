import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { anchorShift, wheelZoom } from './zoom'

interface ZoomAnchor {
  x: number
  y: number
}

// Zoom changes the page's size from its top-left corner, so on its own the
// content under the cursor or fingers slides away. This scrolls by the amount
// the anchor moved, and adds Ctrl+wheel (which is also how Chromium reports a
// trackpad pinch). The anchor is stored in ink units so several events landing
// before React renders still compose.
export function useZoomAnchor(
  pageRef: RefObject<HTMLDivElement | null>,
  zoom: number,
  onZoomChange: ((zoom: number) => void) | undefined,
  scroll: (from: HTMLElement, dx: number, dy: number) => void,
) {
  const anchor = useRef<ZoomAnchor | null>(null)
  const previousZoom = useRef(zoom)
  const liveZoom = useRef(zoom)
  liveZoom.current = zoom

  function anchorAt(clientX: number, clientY: number) {
    const rect = pageRef.current?.getBoundingClientRect()
    if (!rect) return
    anchor.current = { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
  }

  useLayoutEffect(() => {
    const page = pageRef.current
    const from = previousZoom.current
    previousZoom.current = zoom
    if (!page || from === zoom) return

    let at = anchor.current
    anchor.current = null
    if (!at) {
      const body = page.closest('.ink-editor-body')?.getBoundingClientRect()
      if (!body) return
      const rect = page.getBoundingClientRect()
      at = {
        x: (body.left + body.width / 2 - rect.left) / from,
        y: (body.top + body.height / 2 - rect.top) / from,
      }
    }
    scroll(page, -anchorShift(at.x, from, zoom), -anchorShift(at.y, from, zoom))
  }, [zoom, pageRef, scroll])

  useEffect(() => {
    const page = pageRef.current
    if (!page || !onZoomChange) return
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      e.preventDefault()
      anchorAt(e.clientX, e.clientY)
      liveZoom.current = wheelZoom(liveZoom.current, e.deltaY)
      onZoomChange?.(liveZoom.current)
    }
    page.addEventListener('wheel', onWheel, { passive: false })
    return () => page.removeEventListener('wheel', onWheel)
  }, [pageRef, onZoomChange, zoom])

  return anchorAt
}
