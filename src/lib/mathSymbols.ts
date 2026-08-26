// P12-4: a browsable palette, additive to mathSnippets.ts's fixed `/`-triggered
// menu — for a symbol whose LaTeX name isn't already known, browsing beats
// guessing a trigger.
export interface MathSymbol {
  latex: string
  /** A Unicode approximation for the palette button's own label — not a
   *  KaTeX render. Rendering 60+ live equations every time the palette
   *  opens just to label buttons would cost far more than this feature is
   *  worth; the real, exact glyph is what appears in the preview the moment
   *  the symbol is inserted. */
  display: string
  name: string
}

export interface MathSymbolCategory {
  name: string
  symbols: MathSymbol[]
}

export const MATH_SYMBOL_CATEGORIES: MathSymbolCategory[] = [
  {
    name: 'Greek (lowercase)',
    symbols: [
      { latex: '\\alpha', display: 'α', name: 'alpha' },
      { latex: '\\beta', display: 'β', name: 'beta' },
      { latex: '\\gamma', display: 'γ', name: 'gamma' },
      { latex: '\\delta', display: 'δ', name: 'delta' },
      { latex: '\\epsilon', display: 'ε', name: 'epsilon' },
      { latex: '\\zeta', display: 'ζ', name: 'zeta' },
      { latex: '\\eta', display: 'η', name: 'eta' },
      { latex: '\\theta', display: 'θ', name: 'theta' },
      { latex: '\\iota', display: 'ι', name: 'iota' },
      { latex: '\\kappa', display: 'κ', name: 'kappa' },
      { latex: '\\lambda', display: 'λ', name: 'lambda' },
      { latex: '\\mu', display: 'μ', name: 'mu' },
      { latex: '\\nu', display: 'ν', name: 'nu' },
      { latex: '\\xi', display: 'ξ', name: 'xi' },
      { latex: '\\pi', display: 'π', name: 'pi' },
      { latex: '\\rho', display: 'ρ', name: 'rho' },
      { latex: '\\sigma', display: 'σ', name: 'sigma' },
      { latex: '\\tau', display: 'τ', name: 'tau' },
      { latex: '\\phi', display: 'φ', name: 'phi' },
      { latex: '\\chi', display: 'χ', name: 'chi' },
      { latex: '\\psi', display: 'ψ', name: 'psi' },
      { latex: '\\omega', display: 'ω', name: 'omega' },
    ],
  },
  {
    name: 'Greek (uppercase)',
    symbols: [
      { latex: '\\Gamma', display: 'Γ', name: 'Gamma' },
      { latex: '\\Delta', display: 'Δ', name: 'Delta' },
      { latex: '\\Theta', display: 'Θ', name: 'Theta' },
      { latex: '\\Lambda', display: 'Λ', name: 'Lambda' },
      { latex: '\\Xi', display: 'Ξ', name: 'Xi' },
      { latex: '\\Pi', display: 'Π', name: 'Pi' },
      { latex: '\\Sigma', display: 'Σ', name: 'Sigma' },
      { latex: '\\Phi', display: 'Φ', name: 'Phi' },
      { latex: '\\Psi', display: 'Ψ', name: 'Psi' },
      { latex: '\\Omega', display: 'Ω', name: 'Omega' },
    ],
  },
  {
    name: 'Relations',
    symbols: [
      { latex: '\\leq', display: '≤', name: 'less than or equal' },
      { latex: '\\geq', display: '≥', name: 'greater than or equal' },
      { latex: '\\neq', display: '≠', name: 'not equal' },
      { latex: '\\approx', display: '≈', name: 'approximately' },
      { latex: '\\equiv', display: '≡', name: 'equivalent' },
      { latex: '\\sim', display: '∼', name: 'similar to' },
      { latex: '\\propto', display: '∝', name: 'proportional to' },
      { latex: '\\ll', display: '≪', name: 'much less than' },
      { latex: '\\gg', display: '≫', name: 'much greater than' },
    ],
  },
  {
    name: 'Operators',
    symbols: [
      { latex: '\\times', display: '×', name: 'times' },
      { latex: '\\div', display: '÷', name: 'divide' },
      { latex: '\\pm', display: '±', name: 'plus-minus' },
      { latex: '\\mp', display: '∓', name: 'minus-plus' },
      { latex: '\\cdot', display: '·', name: 'dot' },
      { latex: '\\ast', display: '∗', name: 'asterisk' },
      { latex: '\\oplus', display: '⊕', name: 'direct sum' },
      { latex: '\\otimes', display: '⊗', name: 'tensor product' },
      { latex: '\\circ', display: '∘', name: 'composition' },
    ],
  },
  {
    name: 'Set theory',
    symbols: [
      { latex: '\\cup', display: '∪', name: 'union' },
      { latex: '\\cap', display: '∩', name: 'intersection' },
      { latex: '\\setminus', display: '∖', name: 'set minus' },
      { latex: '\\emptyset', display: '∅', name: 'empty set' },
      { latex: '\\subseteq', display: '⊆', name: 'subset or equal' },
      { latex: '\\supseteq', display: '⊇', name: 'superset or equal' },
      { latex: '\\notin', display: '∉', name: 'not an element of' },
      { latex: '\\mathbb{R}', display: 'ℝ', name: 'real numbers' },
      { latex: '\\mathbb{N}', display: 'ℕ', name: 'natural numbers' },
      { latex: '\\mathbb{Z}', display: 'ℤ', name: 'integers' },
      { latex: '\\mathbb{Q}', display: 'ℚ', name: 'rational numbers' },
      { latex: '\\mathbb{C}', display: 'ℂ', name: 'complex numbers' },
    ],
  },
  {
    name: 'Arrows',
    symbols: [
      { latex: '\\to', display: '→', name: 'to' },
      { latex: '\\gets', display: '←', name: 'gets' },
      { latex: '\\Rightarrow', display: '⇒', name: 'implies' },
      { latex: '\\Leftarrow', display: '⇐', name: 'implied by' },
      { latex: '\\Leftrightarrow', display: '⇔', name: 'if and only if' },
      { latex: '\\mapsto', display: '↦', name: 'maps to' },
      { latex: '\\uparrow', display: '↑', name: 'up arrow' },
      { latex: '\\downarrow', display: '↓', name: 'down arrow' },
    ],
  },
  {
    name: 'Misc',
    symbols: [
      { latex: '\\infty', display: '∞', name: 'infinity' },
      { latex: '\\partial', display: '∂', name: 'partial' },
      { latex: '\\nabla', display: '∇', name: 'nabla' },
      { latex: '\\hbar', display: 'ℏ', name: 'h-bar' },
      { latex: '\\ell', display: 'ℓ', name: 'script l' },
      { latex: '\\angle', display: '∠', name: 'angle' },
      { latex: '\\perp', display: '⊥', name: 'perpendicular' },
      { latex: '\\parallel', display: '∥', name: 'parallel' },
      { latex: '\\degree', display: '°', name: 'degree' },
      { latex: '\\ldots', display: '…', name: 'ellipsis' },
    ],
  },
]

export function filterMathSymbols(query: string): MathSymbolCategory[] {
  if (!query) return MATH_SYMBOL_CATEGORIES
  const q = query.toLowerCase()
  return MATH_SYMBOL_CATEGORIES.map((category) => ({
    ...category,
    symbols: category.symbols.filter(
      (s) => s.name.toLowerCase().includes(q) || s.latex.toLowerCase().includes(q),
    ),
  })).filter((category) => category.symbols.length > 0)
}

/** Shared by `BlockMath`/`InlineMath`'s registered `insertSymbol` handles —
 *  the palette itself now lives in the top toolbar (outside either node
 *  view), so only this pure "where does it land" computation is common
 *  enough to share; the toolbar reaches whichever node view is currently
 *  being edited through `useMathEditorStore`. Takes the raw latex string
 *  rather than a whole `MathSymbol` — `MathEditorHandle.insertSymbol` only
 *  ever has the string, not the symbol's display glyph or name. */
export function insertSymbolAt(value: string, cursor: number, latex: string): { text: string; cursor: number } {
  const text = value.slice(0, cursor) + latex + value.slice(cursor)
  return { text, cursor: cursor + latex.length }
}
