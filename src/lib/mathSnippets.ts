// P6-4: one editable table, not code scattered per snippet.
export interface MathSnippet {
  trigger: string
  latex: string
  description: string
}

export const MATH_SNIPPETS: MathSnippet[] = [
  { trigger: 'gradient', latex: '\\nabla f(x)', description: 'Gradient' },
  { trigger: 'partial', latex: '\\frac{\\partial f}{\\partial x}', description: 'Partial derivative' },
  { trigger: 'frac', latex: '\\frac{a}{b}', description: 'Fraction' },
  { trigger: 'sqrt', latex: '\\sqrt{x}', description: 'Square root' },
  { trigger: 'sum', latex: '\\sum_{i=1}^{n}', description: 'Summation' },
  { trigger: 'prod', latex: '\\prod_{i=1}^{n}', description: 'Product' },
  { trigger: 'int', latex: '\\int_{a}^{b}', description: 'Definite integral' },
  { trigger: 'lim', latex: '\\lim_{x \\to \\infty}', description: 'Limit' },
  { trigger: 'vec', latex: '\\vec{v}', description: 'Vector' },
  { trigger: 'binom', latex: '\\binom{n}{k}', description: 'Binomial coefficient' },
  { trigger: 'matrix', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', description: '2×2 matrix' },
  { trigger: 'cases', latex: '\\begin{cases} a & x < 0 \\\\ b & x \\ge 0 \\end{cases}', description: 'Piecewise (cases)' },
  { trigger: 'infty', latex: '\\infty', description: 'Infinity' },
  { trigger: 'in', latex: '\\in', description: 'Element of' },
  { trigger: 'subset', latex: '\\subseteq', description: 'Subset' },
  { trigger: 'forall', latex: '\\forall', description: 'For all' },
  { trigger: 'exists', latex: '\\exists', description: 'Exists' },
  { trigger: 'implies', latex: '\\implies', description: 'Implies' },
  { trigger: 'iff', latex: '\\iff', description: 'If and only if' },
  { trigger: 'approx', latex: '\\approx', description: 'Approximately' },
]

export interface ActiveSlashQuery {
  start: number
  query: string
}

// Finds the `/query` immediately before the cursor — same "nothing but the
// slash itself starts it, whitespace ends it" rule the editor-wide
// SlashCommands extension already uses.
export function activeSlashQuery(text: string, cursor: number): ActiveSlashQuery | null {
  const before = text.slice(0, cursor)
  const slashIndex = before.lastIndexOf('/')
  if (slashIndex === -1) return null
  const query = before.slice(slashIndex + 1)
  if (/\s/.test(query)) return null
  return { start: slashIndex, query }
}

export function matchMathSnippets(query: string): MathSnippet[] {
  if (!query) return MATH_SNIPPETS
  const q = query.toLowerCase()
  return MATH_SNIPPETS.filter(
    (s) => s.trigger.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
  )
}

export function applyMathSnippet(
  text: string,
  active: ActiveSlashQuery,
  cursor: number,
  snippet: MathSnippet,
): { text: string; cursor: number } {
  const next = text.slice(0, active.start) + snippet.latex + text.slice(cursor)
  return { text: next, cursor: active.start + snippet.latex.length }
}
