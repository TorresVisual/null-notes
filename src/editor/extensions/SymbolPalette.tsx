import { useState } from 'react'
import type { FocusEvent } from 'react'
import { filterMathSymbols } from '../../lib/mathSymbols'
import type { MathSymbol } from '../../lib/mathSymbols'

interface SymbolPaletteProps {
  onSelect: (symbol: MathSymbol) => void
  onClose: () => void
  /** The search input steals focus on mount (`autoFocus`). This lives in
   *  the top toolbar, outside any math node's own editing overlay — the
   *  caller uses this to notice when focus leaves the palette *and* doesn't
   *  land back in whichever equation is active, so that equation still
   *  commits and closes on a real "click away," the same as if the palette
   *  had never opened. */
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void
}

/** P12-4: browsable, additive to `MathSnippetMenu`'s fixed `/`-triggered
 *  menu — a symbol can be found here without already knowing its trigger.
 *  Lives in the top toolbar (`InsertGroup`), not inside either math node's
 *  own editing overlay, so it works whether or not an equation is
 *  currently open. */
export function SymbolPalette({ onSelect, onClose, onBlur }: SymbolPaletteProps) {
  const [query, setQuery] = useState('')
  const categories = filterMathSymbols(query)

  return (
    <div className="symbol-palette" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
      <input
        type="text"
        className="symbol-palette-search"
        placeholder="Search symbols…"
        autoFocus
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          onClose()
        }}
      />
      <div className="symbol-palette-body">
        {categories.length === 0 && <div className="symbol-palette-empty">No symbols match “{query}”.</div>}
        {categories.map((category) => (
          <div key={category.name} className="symbol-palette-category">
            <div className="symbol-palette-category-name">{category.name}</div>
            <div className="symbol-palette-grid">
              {category.symbols.map((s) => (
                <button
                  key={s.latex}
                  type="button"
                  className="symbol-palette-item"
                  title={`${s.name} — ${s.latex}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onSelect(s)
                  }}
                >
                  {s.display}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
