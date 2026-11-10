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

// How much of the layout viewport the soft keyboard covers. Zero when the
// WebView itself is resized above the keyboard (MainActivity), because then
// the visual viewport fills it; non-zero where the keyboard overlays the page.
export function keyboardInset(innerHeight: number, viewportHeight: number, viewportOffsetTop: number): number {
  return Math.max(0, innerHeight - viewportHeight - viewportOffsetTop)
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

// The fixed edit toolbar and the pencil/Done button read `--keyboard-inset`
// to sit on the keyboard rather than under it.
export function useKeyboardInset() {
  useEffect(() => {
    if (!isMobile()) return
    const viewport = window.visualViewport
    const root = document.documentElement
    const update = () => {
      const inset = viewport ? keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop) : 0
      root.style.setProperty('--keyboard-inset', `${inset}px`)
    }
    update()
    const target: EventTarget = viewport ?? window
    target.addEventListener('resize', update)
    target.addEventListener('scroll', update)
    return () => {
      target.removeEventListener('resize', update)
      target.removeEventListener('scroll', update)
      root.style.removeProperty('--keyboard-inset')
    }
  }, [])
}
