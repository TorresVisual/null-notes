export interface PlotSpec {
  exprs: string[]
  xMin: number
  xMax: number
}

export interface PlotSeries {
  expr: string
  points: Array<[number, number] | null>
  error: boolean
}

const DEFAULT_RANGE: [number, number] = [-10, 10]
const SAMPLES = 400

const FUNCTIONS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }

type Evaluator = (x: number) => number

// Recursive descent over: sum > product > unary > power > atom. `n` is an
// alias for `x` so complexity curves read as written (n log n, n^2).
// Implicit multiplication ("2x", "n log n") is supported between a number or
// closing paren and an identifier/paren, and between identifiers/atoms.
export function compileExpression(source: string): Evaluator {
  const tokens = source.toLowerCase().match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-z_]\w*|[-+*/^()]|\S/g) ?? []
  let pos = 0

  const peek = () => tokens[pos]
  const take = () => tokens[pos++]
  const fail = (): never => {
    throw new Error(`Cannot parse "${source}"`)
  }

  function sum(): Evaluator {
    let left = product()
    while (peek() === '+' || peek() === '-') {
      const op = take()
      const a = left
      const b = product()
      left = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x)
    }
    return left
  }

  function startsAtom(t: string | undefined) {
    return t !== undefined && (t === '(' || /^[\d.a-z_]/.test(t))
  }

  function product(): Evaluator {
    let left = unary()
    while (peek() === '*' || peek() === '/' || startsAtom(peek())) {
      const op = peek() === '*' || peek() === '/' ? take() : '*'
      const a = left
      const b = unary()
      left = op === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x)
    }
    return left
  }

  function unary(): Evaluator {
    if (peek() === '-') {
      take()
      const inner = unary()
      return (x) => -inner(x)
    }
    if (peek() === '+') {
      take()
      return unary()
    }
    return power()
  }

  function power(): Evaluator {
    const base = atom()
    if (peek() !== '^') return base
    take()
    const exponent = unary()
    return (x) => Math.pow(base(x), exponent(x))
  }

  function atom(): Evaluator {
    const t = take()
    if (t === undefined) return fail()
    if (t === '(') {
      const inner = sum()
      if (take() !== ')') fail()
      return inner
    }
    if (/^[\d.]/.test(t)) {
      const value = Number(t)
      if (Number.isNaN(value)) fail()
      return () => value
    }
    if (t === 'x' || t === 'n') return (x) => x
    const constant = CONSTANTS[t]
    if (constant !== undefined) return () => constant
    const fn = FUNCTIONS[t]
    if (fn) {
      // "log n" without parentheses binds to the next power-level operand.
      const arg = peek() === '(' ? atom() : power()
      return (x) => fn(arg(x))
    }
    return fail()
  }

  const result = sum()
  if (pos < tokens.length) fail()
  return result
}

export function parsePlotSource(source: string): PlotSpec {
  let [xMin, xMax] = DEFAULT_RANGE
  const exprs: string[] = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const range = /^(?:x|n)?\s*(?:range)?\s*:\s*(-?[\d.]+)\s*(?:\.\.|to|,)\s*(-?[\d.]+)$/i.exec(line)
    if (range) {
      const lo = Number(range[1])
      const hi = Number(range[2])
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo < hi) {
        xMin = lo
        xMax = hi
      }
      continue
    }
    exprs.push(line.replace(/^y\s*=\s*|^f\(x\)\s*=\s*/i, ''))
  }
  return { exprs, xMin, xMax }
}

export function samplePlot(spec: PlotSpec): PlotSeries[] {
  return spec.exprs.map((expr) => {
    let fn: Evaluator
    try {
      fn = compileExpression(expr)
    } catch {
      return { expr, points: [], error: true }
    }
    const points = Array.from({ length: SAMPLES + 1 }, (_, i): [number, number] | null => {
      const x = spec.xMin + ((spec.xMax - spec.xMin) * i) / SAMPLES
      const y = fn(x)
      return Number.isFinite(y) ? [x, y] : null
    })
    return { expr, points, error: false }
  })
}

// Clamps the y-range to the middle of the data so a pole (1/x, tan) doesn't
// flatten every other curve to a line.
export function yBounds(series: PlotSeries[]): [number, number] {
  const ys = series
    .flatMap((s) => s.points.flatMap((p) => (p ? [p[1]] : [])))
    .sort((a, b) => a - b)
  if (ys.length === 0) return [-1, 1]
  const lo = ys[Math.floor(ys.length * 0.02)] ?? 0
  const hi = ys[Math.ceil(ys.length * 0.98) - 1] ?? 0
  const pad = (hi - lo || 1) * 0.08
  return [lo - pad, hi + pad]
}
