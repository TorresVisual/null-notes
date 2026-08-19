import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import {
  activeSlashQuery,
  applyMathSnippet,
  matchMathSnippets,
  type MathSnippet,
} from '../lib/mathSnippets'

interface MathSnippetMenuState {
  matches: MathSnippet[]
  selected: number
  select: (snippet: MathSnippet) => void
  handleKeyDown: (e: { key: string; preventDefault: () => void }) => boolean
}

// Shared by InlineMath's <input> and BlockMath's <textarea> — both are plain
// HTML form controls living outside ProseMirror's document (see
// docs/ROADMAP.md P6-4), so the editor-wide SlashCommands suggestion plugin,
// which only sees PM transactions, structurally cannot reach typing inside
// either one. This re-implements the same "/" trigger for the one context
// that plugin can't cover: editing LaTeX source.
export function useMathSnippetMenu(
  value: string,
  cursor: number,
  onChange: (next: string) => void,
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
): MathSnippetMenuState {
  const active = activeSlashQuery(value, cursor)
  const matches = active ? matchMathSnippets(active.query) : []
  const [selected, setSelected] = useState(0)

  useEffect(() => setSelected(0), [active?.start, active?.query])

  function select(snippet: MathSnippet) {
    if (!active) return
    const result = applyMathSnippet(value, active, cursor, snippet)
    onChange(result.text)
    // The value change is controlled (React re-render), so the caret has to
    // be repositioned after the DOM catches up, not in this same tick.
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(result.cursor, result.cursor))
  }

  function handleKeyDown(e: { key: string; preventDefault: () => void }): boolean {
    if (!matches.length) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(matches.length - 1, s + 1))
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const snippet = matches[selected]
      if (snippet) {
        e.preventDefault()
        select(snippet)
        return true
      }
    }
    return false
  }

  return { matches, selected, select, handleKeyDown }
}
