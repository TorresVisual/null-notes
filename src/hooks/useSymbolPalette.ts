import { useState } from 'react'
import type { RefObject } from 'react'
import type { MathSymbol } from '../lib/mathSymbols'

interface SymbolPaletteState {
  open: boolean
  toggle: () => void
  close: () => void
  insert: (symbol: MathSymbol) => void
}

// Shared by InlineMath's <input> and BlockMath's <textarea> (P12-4) — the
// palette panel itself is plain markup, only "where does the symbol land"
// is common enough to share: insert at the field's last known caret
// position (the same `cursor` state `useMathSnippetMenu` already tracks),
// then move the caret past it — deferred a frame, since the value change is
// controlled and the DOM hasn't caught up yet within this same tick.
export function useSymbolPalette(
  value: string,
  cursor: number,
  onChange: (next: string) => void,
  onCursorChange: (next: number) => void,
  fieldRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
): SymbolPaletteState {
  const [open, setOpen] = useState(false)

  function insert(symbol: MathSymbol) {
    const next = value.slice(0, cursor) + symbol.latex + value.slice(cursor)
    const nextCursor = cursor + symbol.latex.length
    onChange(next)
    onCursorChange(nextCursor)
    setOpen(false)
    requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  return { open, toggle: () => setOpen((o) => !o), close: () => setOpen(false), insert }
}
