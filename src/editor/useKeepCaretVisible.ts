import { useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { isMobile } from '../lib/platform'

// ProseMirror scrolls the caret to the scroll port's edge, which on a phone is
// under the bottom-pinned editor toolbar (~62px tall), so reserve that band.
const TOOLBAR_CLEARANCE_PX = 80

export function caretScrollProps(mobile: boolean) {
  if (!mobile) return {}
  const sides = { top: 5, right: 5, bottom: TOOLBAR_CLEARANCE_PX, left: 5 }
  return { scrollMargin: sides, scrollThreshold: sides }
}

// The keyboard opening shrinks the viewport but leaves the scroll offset, so
// the line being typed ends up under the IME. visualViewport is the shared
// signal; window 'resize' is the same event where it is missing (and in jsdom).
export function useKeepCaretVisible(editor: Editor | null) {
  useEffect(() => {
    if (!editor || !isMobile()) return
    const target: EventTarget = window.visualViewport ?? window
    const onResize = () => {
      if (editor.isFocused) editor.commands.scrollIntoView()
    }
    target.addEventListener('resize', onResize)
    return () => target.removeEventListener('resize', onResize)
  }, [editor])
}
