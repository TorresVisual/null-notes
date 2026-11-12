import { useRef, type TouchEvent } from 'react'

export const PULL_DISTANCE_PX = 90

// Pan surfaces (the canvas) own vertical drags themselves.
const OWNS_DRAG = '.react-flow'

function atTop(target: EventTarget | null, root: Element): boolean {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el.scrollTop > 0) return false
    if (el === root) return true
  }
  return true
}

// Fires on release, so dragging back above the threshold cancels. Every
// scroller between the finger and `currentTarget` must sit at its top both
// when the touch starts and when it ends, which keeps an ordinary scroll that
// merely passes through the top from counting as a pull.
export function usePullDown(onPull: () => void, enabled: boolean) {
  const start = useRef<{ x: number; y: number; target: EventTarget | null } | null>(null)

  if (!enabled) return {}

  return {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      const t = e.touches[0]
      const eligible =
        t !== undefined &&
        e.touches.length === 1 &&
        atTop(e.target, e.currentTarget) &&
        !(e.target instanceof Element && e.target.closest(OWNS_DRAG))
      start.current = eligible ? { x: t.clientX, y: t.clientY, target: e.target } : null
    },
    onTouchEnd: (e: TouchEvent<HTMLElement>) => {
      const s = start.current
      const t = e.changedTouches[0]
      start.current = null
      if (!s || !t) return
      const dy = t.clientY - s.y
      const dx = Math.abs(t.clientX - s.x)
      if (dy < PULL_DISTANCE_PX || dy < 2 * dx) return
      if (!atTop(s.target, e.currentTarget)) return
      if (window.getSelection()?.isCollapsed === false) return
      onPull()
    },
    onTouchCancel: () => {
      start.current = null
    },
  }
}
