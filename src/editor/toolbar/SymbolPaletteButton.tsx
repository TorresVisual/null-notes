import { useRef, useState } from 'react'
import { Omega } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { SymbolPalette } from '../extensions/SymbolPalette'
import { focusLeftMathEditingSurface } from '../../lib/mathEditorFocus'
import { useMathEditorStore } from '../../store/mathEditor'
import type { MathSymbol } from '../../lib/mathSymbols'

interface SymbolPaletteButtonProps {
  editor: Editor
}

export function SymbolPaletteButton({ editor }: SymbolPaletteButtonProps) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Set synchronously the instant a symbol is picked, read by the palette's
  // own onBlur below. Without it, that onBlur's deferred "did focus really
  // leave" check would race the field's own `requestAnimationFrame` refocus
  // (see `insertSymbol` on `BlockMath`/`InlineMath`) — usually rAF wins, but
  // "usually" is exactly the kind of bug that only shows up once in a
  // while. This flag makes picking a symbol never a "leaving" event at all,
  // deterministically, regardless of how those two callbacks interleave.
  const justPickedSymbolRef = useRef(false)

  function insertSymbol(symbol: MathSymbol) {
    justPickedSymbolRef.current = true
    const activeEditor = useMathEditorStore.getState().activeEditor
    if (activeEditor) {
      // A math node is already open — the symbol goes into its draft, the
      // same place clicking a `MathSnippetMenu` entry would land it.
      activeEditor.insertSymbol(symbol.latex)
    } else {
      // Nothing open — seed a fresh inline-math node at the cursor, the
      // same shape the Sigma button uses to insert an empty one.
      editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex: symbol.latex } }).run()
    }
    setPaletteOpen(false)
  }

  return (
    <div className="symbol-palette-anchor">
      <button
        className="toolbar-button"
        aria-label="Symbol palette"
        title="Symbol palette — inserts into the open equation, or a new one"
        onClick={() => setPaletteOpen((open) => !open)}
      >
        <Omega size={15} />
      </button>
      {paletteOpen && (
        <SymbolPalette
          onSelect={insertSymbol}
          onClose={() => setPaletteOpen(false)}
          onBlur={() => {
            if (justPickedSymbolRef.current) {
              justPickedSymbolRef.current = false
              return
            }
            // The palette's autofocused search stole focus from whichever
            // equation was open (if any). If focus, after leaving here,
            // hasn't landed back in that equation either, this is a real
            // "click away" — close it now rather than leaving it open
            // with no field left focused to close it later.
            const activeEditor = useMathEditorStore.getState().activeEditor
            setTimeout(() => {
              if (!focusLeftMathEditingSurface(document.activeElement)) return
              activeEditor?.commitAndClose()
            }, 0)
          }}
        />
      )}
    </div>
  )
}
