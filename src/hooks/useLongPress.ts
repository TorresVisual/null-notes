import { useRef, type MouseEvent } from 'react'

// Touch-timer rather than `contextmenu`: iOS WebKit never fires contextmenu on
// a long press. The click that follows the lift is swallowed so the row's own
// tap action doesn't also run.
export function useLongPress(onLongPress: () => void, delay = 500) {
  const timer = useRef<number | undefined>(undefined)
  const fired = useRef(false)
  const clear = () => window.clearTimeout(timer.current)

  return {
    onTouchStart: () => {
      fired.current = false
      timer.current = window.setTimeout(() => {
        fired.current = true
        onLongPress()
      }, delay)
    },
    onTouchMove: clear,
    onTouchEnd: clear,
    onTouchCancel: clear,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current) return
      fired.current = false
      e.stopPropagation()
      e.preventDefault()
    },
  }
}
