import { MATH_SYMBOL_CATEGORIES, type MathSymbol } from './mathSymbols'

export interface TextEdit {
  text: string
  cursor: number
}

const CLOSER: Record<string, string> = { '{': '}', '(': ')', '[': ']' }
const CLOSERS = new Set(Object.values(CLOSER))

const isEscaped = (text: string, i: number): boolean => text[i - 1] === '\\'

export function autoClose(text: string, cursor: number, key: string): TextEdit | null {
  const closer = CLOSER[key]
  if (!closer || isEscaped(text, cursor)) return null
  return { text: text.slice(0, cursor) + key + closer + text.slice(cursor), cursor: cursor + 1 }
}

// `multiline` is the block editor's textarea; the inline editor is a one-line
// <input>, where a newline would be swallowed.
export function typeCloser(text: string, cursor: number, key: string, multiline: boolean): TextEdit | null {
  if (!CLOSERS.has(key) || text[cursor] !== key) return null
  const after = cursor + 1
  const begin = key === '}' ? /\\begin\{([a-zA-Z]+\*?)\}$/.exec(text.slice(0, after)) : null
  const name = begin?.[1]
  if (!name || text.slice(after).includes(`\\end{${name}}`)) return { text, cursor: after }
  const sep = multiline ? '\n' : ' '
  return {
    text: `${text.slice(0, after)}${sep}${sep}\\end{${name}}${text.slice(after)}`,
    cursor: after + 1,
  }
}

export function backspacePair(text: string, cursor: number): TextEdit | null {
  const closer = CLOSER[text[cursor - 1] ?? '']
  if (!closer || text[cursor] !== closer) return null
  return { text: text.slice(0, cursor - 1) + text.slice(cursor + 1), cursor: cursor - 1 }
}

// Stateless on purpose: nothing to invalidate when the user edits mid-snippet.
// Leaves the innermost `{…}` around the cursor, and enters the next group if
// one follows directly (`\frac{a|}{b}` → `\frac{a}{|b}`).
export function nextSlot(text: string, cursor: number): number | null {
  let depth = 0
  let open = -1
  for (let i = cursor - 1; i >= 0; i--) {
    if (isEscaped(text, i)) continue
    if (text[i] === '}') depth++
    else if (text[i] === '{') {
      if (depth === 0) {
        open = i
        break
      }
      depth--
    }
  }
  if (open === -1) return null
  depth = 0
  for (let j = cursor; j < text.length; j++) {
    if (isEscaped(text, j)) continue
    if (text[j] === '{') depth++
    else if (text[j] === '}') {
      if (depth === 0) return text[j + 1] === '{' ? j + 2 : j + 1
      depth--
    }
  }
  return null
}

export interface ActiveCommandQuery {
  start: number
  query: string
}

export function activeCommandQuery(text: string, cursor: number): ActiveCommandQuery | null {
  const match = /\\([a-zA-Z]{2,})$/.exec(text.slice(0, cursor))
  return match ? { start: match.index, query: match[1] ?? '' } : null
}

const MAX_COMMAND_MATCHES = 8
const ALL_SYMBOLS: MathSymbol[] = MATH_SYMBOL_CATEGORIES.flatMap((c) => c.symbols)

export function matchMathCommands(query: string): MathSymbol[] {
  const q = `\\${query.toLowerCase()}`
  return ALL_SYMBOLS.filter((s) => s.latex.toLowerCase().startsWith(q)).slice(0, MAX_COMMAND_MATCHES)
}

export function applyMathCommand(text: string, active: ActiveCommandQuery, cursor: number, latex: string): TextEdit {
  return { text: text.slice(0, active.start) + latex + text.slice(cursor), cursor: active.start + latex.length }
}
