import { useEffect, useRef } from 'react'
import { rememberPosition, recallPosition } from '../lib/notePositions'

interface RawEditorProps {
  content: string
  notePath: string
  spellcheck: boolean
  spellcheckLanguage: string
  onChange: (markdown: string) => void
}

export function RawEditor({ content, notePath, spellcheck, spellcheckLanguage, onChange }: RawEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // A fresh instance mounts every time the raw view opens (Layout only
  // renders it while viewMode === 'raw'), so "on mount" is exactly "on
  // switching into this view" — the caret lands at the same fraction through
  // the note the rendered view's cursor last sat at.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fraction = recallPosition(notePath)?.cursorFraction ?? 0
    const offset = Math.round(fraction * content.length)
    el.setSelectionRange(offset, offset)
    // Deliberately mount-only: content changes from the user's own typing
    // shouldn't re-jump the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notePath])

  const recordCursor = () => {
    const el = ref.current
    if (!el) return
    rememberPosition(notePath, {
      cursorFraction: content.length > 0 ? el.selectionStart / content.length : 0,
    })
  }

  return (
    <textarea
      ref={ref}
      className="raw-editor"
      value={content}
      onChange={(e) => onChange(e.target.value)}
      onSelect={recordCursor}
      spellCheck={spellcheck}
      lang={spellcheckLanguage}
      aria-label="Raw markdown"
    />
  )
}
