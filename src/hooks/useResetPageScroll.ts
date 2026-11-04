import { useEffect } from 'react'
import { isMobile } from '../lib/platform'

// The shell never scrolls the document (html/body are overflow:hidden, panes
// scroll themselves), but focusing an input under the iOS keyboard shifts it
// programmatically and nothing shifts it back. Reset once focus has left.
export function useResetPageScroll() {
  useEffect(() => {
    if (!isMobile()) return
    const reset = () => {
      if (document.activeElement?.matches('input, textarea, [contenteditable="true"]')) return
      for (const el of [document.documentElement, document.body]) {
        el.scrollTo(0, 0)
      }
      window.scrollTo(0, 0)
    }
    const target: EventTarget = window.visualViewport ?? window
    const onFocusOut = () => setTimeout(reset, 100)
    document.addEventListener('focusout', onFocusOut)
    target.addEventListener('resize', reset)
    return () => {
      document.removeEventListener('focusout', onFocusOut)
      target.removeEventListener('resize', reset)
    }
  }, [])
}
