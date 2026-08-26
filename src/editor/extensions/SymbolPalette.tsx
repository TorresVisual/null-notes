import { useState } from 'react'
import type { FocusEvent } from 'react'
import { filterMathSymbols } from '../../lib/mathSymbols'
import type { MathSymbol } from '../../lib/mathSymbols'

interface SymbolPaletteProps {
  onSelect: (symbol: MathSymbol) => void
  onClose: () => void
  /** The search input steals focus on mount (`autoFocus`) the same way the
   *  equation-number field can — the caller passes the same
   *  `commitUnlessFocusLeaves`-backed handler its own latex field uses, so
   *  blurring *out of the whole editor* from in here still commits, and
   *  blurring *into* it (the normal open case) doesn't. */
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void
}

/** P12-4: browsable, additive to `MathSnippetMenu`'s fixed `/`-triggered
 *  menu — a symbol can be found here without already knowing its trigger. */
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
