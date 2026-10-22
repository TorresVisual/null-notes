import { useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { isMobile } from '../lib/platform'

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
