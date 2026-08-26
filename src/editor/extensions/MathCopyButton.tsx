import { useState } from 'react'
import { writeToClipboard } from '../../lib/clipboard'

interface MathCopyButtonProps {
  latex: string
  className: string
}

/** Shared by `InlineMath` and `BlockMath` (P12-1) — copies raw LaTeX source
 * to the clipboard, with the same transient "Copied" feedback P11-1's
 * code-block copy button already uses. The action runs on `mouseDown`, not
 * `click` — the same choice `MathSnippetMenu.tsx`'s own buttons already
 * made: `mousedown` fires *before* the input's `blur`, so acting there
 * (with `preventDefault` to also stop the focus shift that would trigger
 * that blur) beats the input's `onBlur={() => commit(false)}` closing the
 * editor — and unmounting this button — before a deferred `click` could
 * ever fire. */
export function MathCopyButton({ latex, className }: MathCopyButtonProps) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      className={`${className}${copied ? ' copied' : ''}`}
      title="Copy LaTeX"
      onMouseDown={(e) => {
        e.preventDefault()
        void writeToClipboard(latex).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
