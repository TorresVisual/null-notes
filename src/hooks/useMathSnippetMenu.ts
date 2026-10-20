import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import {
  activeSlashQuery,
  applyMathSnippet,
  matchMathSnippets,
} from '../lib/mathSnippets'
import {
  activeCommandQuery,
  applyMathCommand,
  autoClose,
  backspacePair,
  matchMathCommands,
  nextSlot,
  typeCloser,
  type TextEdit,
} from '../lib/mathInput'

export interface MathMenuItem {
  key: string
  label: string
  description: string
  apply: () => TextEdit
  /** A `\command` completion is accepted with Tab only — Enter stays a newline in the block editor. */
  tabOnly: boolean
}

interface MathKeyEvent {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  preventDefault: () => void
}

interface MathSnippetMenuState {
  matches: MathMenuItem[]
  selected: number
  select: (item: MathMenuItem) => void
  handleKeyDown: (e: MathKeyEvent) => boolean
}

// Shared by InlineMath's <input> and BlockMath's <textarea> — both are plain
// HTML form controls living outside ProseMirror's document (see
// docs/ROADMAP.md P6-4), so the editor-wide SlashCommands suggestion plugin,
// which only sees PM transactions, structurally cannot reach typing inside
// either one. This re-implements the same "/" trigger for the one context
// that plugin can't cover: editing LaTeX source — and carries the rest of the
// LaTeX typing aids (`\command` completion, bracket pairing, Tab between
// `{}` slots) for the same reason.
export function useMathSnippetMenu(
  value: string,
  cursor: number,
  onChange: (next: string) => void,
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
): MathSnippetMenuState {
  const slash = activeSlashQuery(value, cursor)
  const command = activeCommandQuery(value, cursor)
  const slashMatches = slash ? matchMathSnippets(slash.query) : []
  const commandMatches = !slashMatches.length && command ? matchMathCommands(command.query) : []

  const matches: MathMenuItem[] = slashMatches.length
    ? slashMatches.map((s) => ({
        key: s.trigger,
        label: `/${s.trigger}`,
        description: s.description,
        apply: () => (slash ? applyMathSnippet(value, slash, cursor, s) : { text: value, cursor }),
        tabOnly: false,
      }))
    : commandMatches.map((s) => ({
        key: s.latex,
        label: s.latex,
        description: `${s.display} ${s.name}`,
        apply: () => (command ? applyMathCommand(value, command, cursor, s.latex) : { text: value, cursor }),
        tabOnly: true,
      }))

  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [slash?.start, slash?.query, command?.start, command?.query])

  function commit(edit: TextEdit) {
    onChange(edit.text)
    // The value change is controlled (React re-render), so the caret has to
    // be repositioned after the DOM catches up, not in this same tick.
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(edit.cursor, edit.cursor))
  }

  function select(item: MathMenuItem) {
    commit(item.apply())
  }

  function handleKeyDown(e: MathKeyEvent): boolean {
    if (matches.length) {
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
      const item = matches[selected]
      if (item && (e.key === 'Tab' || (e.key === 'Enter' && !item.tabOnly))) {
        e.preventDefault()
        select(item)
        return true
      }
    }

    const el = inputRef.current
    // AltGr arrives as ctrl+alt, and `{ [ ]` are AltGr chords on German
    // layouts, so "plain" must admit exactly that combination.
    if (!el || e.metaKey || e.ctrlKey !== e.altKey) return false
    const start = el.selectionStart ?? 0
    if (start !== el.selectionEnd) return false
    const text = el.value
    const multiline = el instanceof HTMLTextAreaElement

    if (e.key === 'Tab' && !e.shiftKey) {
      const pos = nextSlot(text, start)
      if (pos === null) return false
      e.preventDefault()
      el.setSelectionRange(pos, pos)
      return true
    }
    const edit =
      e.key === 'Backspace'
        ? backspacePair(text, start)
        : (typeCloser(text, start, e.key, multiline) ?? autoClose(text, start, e.key))
    if (!edit) return false
    e.preventDefault()
    commit(edit)
    return true
  }

  return { matches, selected, select, handleKeyDown }
}
