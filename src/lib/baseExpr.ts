import type { BaseRow } from '../types'
import { FUNCTIONS, KNOWN_NAMES, LAZY_METHODS, relativePath } from './baseFunctions'
import type { FnContext } from './baseFunctions'
import {
  compare,
  equals,
  fromJson,
  isDate,
  isDuration,
  isFileRef,
  isTruthy,
  makeDate,
  makeDuration,
  parseDuration,
  shiftDate,
  toStr,
  typeName,
} from './baseValue'
import type { BaseFileRef, BaseValue } from './baseValue'

export type Expr =
  | { t: 'lit'; v: BaseValue }
  | { t: 'id'; name: string }
  | { t: 'member'; obj: Expr; prop: string }
  | { t: 'index'; obj: Expr; idx: Expr }
  | { t: 'call'; callee: Expr; args: Expr[] }
  | { t: 'unary'; op: '!' | '-'; arg: Expr }
  | { t: 'bin'; op: string; l: Expr; r: Expr }

export interface Scope {
  row: BaseRow
  thisRow: BaseRow | null
  formulas: Record<string, Expr>
  /** Workspace folder: `file.path` and `file.inFolder` are relative to it. */
  root?: string
  /** Fixed clock for tests; defaults to the real one. */
  now?: number
  locals?: Record<string, BaseValue>
  resolving?: string[]
}

export type ParsedExpr = { ok: true; expr: Expr } | { ok: false; error: string }

interface Token {
  type: 'num' | 'str' | 'id' | 'op' | 'regex' | 'end'
  value: string
  pos: number
  flags?: string
}

class ParseError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message)
  }
}

const OPERATORS = ['||', '&&', '==', '!=', '>=', '<=', '>', '<', '+', '-', '*', '/', '%', '!', '(', ')', '[', ']', ',', '.']
const IDENT = /[\p{L}_$][\p{L}\p{N}_$]*/uy
const NUMBER = /\d+(?:\.\d+)?/y

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const valueEnds = () => {
    const last = tokens[tokens.length - 1]
    return !!last && (last.type !== 'op' || last.value === ')' || last.value === ']')
  }
  while (i < src.length) {
    const c = src.charAt(i)
    if (/\s/.test(c)) {
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      let value = ''
      let j = i + 1
      while (j < src.length && src.charAt(j) !== c) {
        if (src.charAt(j) === '\\' && j + 1 < src.length) j += 1
        value += src.charAt(j)
        j += 1
      }
      if (j >= src.length) throw new ParseError('Unterminated string', i)
      tokens.push({ type: 'str', value, pos: i })
      i = j + 1
      continue
    }
    if (c === '/' && !valueEnds()) {
      let j = i + 1
      let source = ''
      while (j < src.length && src.charAt(j) !== '/') {
        if (src.charAt(j) === '\\' && j + 1 < src.length) {
          source += src.charAt(j)
          j += 1
        }
        source += src.charAt(j)
        j += 1
      }
      if (j >= src.length) throw new ParseError('Unterminated regular expression', i)
      let k = j + 1
      while (/[a-z]/.test(src.charAt(k))) k += 1
      tokens.push({ type: 'regex', value: source, flags: src.slice(j + 1, k), pos: i })
      i = k
      continue
    }
    NUMBER.lastIndex = i
    const number = NUMBER.exec(src)
    if (number) {
      tokens.push({ type: 'num', value: number[0], pos: i })
      i = NUMBER.lastIndex
      continue
    }
    IDENT.lastIndex = i
    const ident = IDENT.exec(src)
    if (ident) {
      tokens.push({ type: 'id', value: ident[0], pos: i })
      i = IDENT.lastIndex
      continue
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i))
    if (!op) throw new ParseError(`Unexpected character "${c}"`, i)
    tokens.push({ type: 'op', value: op, pos: i })
    i += op.length
  }
  tokens.push({ type: 'end', value: '', pos: src.length })
  return tokens
}

class Parser {
  private at = 0
  constructor(private readonly tokens: Token[]) {}

  private get peek(): Token {
    return this.tokens[this.at] as Token
  }

  private isOp(...ops: string[]): boolean {
    return this.peek.type === 'op' && ops.includes(this.peek.value)
  }

  private expectOp(op: string): void {
    if (!this.isOp(op)) throw new ParseError(`Expected "${op}"`, this.peek.pos)
    this.at += 1
  }

  parse(): Expr {
    const expr = this.or()
    if (this.peek.type !== 'end') throw new ParseError('Unexpected token', this.peek.pos)
    return expr
  }

  private binary(next: () => Expr, ...ops: string[]): Expr {
    let left = next()
    while (this.isOp(...ops)) {
      const op = this.peek.value
      this.at += 1
      left = { t: 'bin', op, l: left, r: next() }
    }
    return left
  }

  private or = (): Expr => this.binary(this.and, '||')
  private and = (): Expr => this.binary(this.equality, '&&')
  private equality = (): Expr => this.binary(this.relational, '==', '!=')
  private relational = (): Expr => this.binary(this.additive, '<', '>', '<=', '>=')
  private additive = (): Expr => this.binary(this.multiplicative, '+', '-')
  private multiplicative = (): Expr => this.binary(this.unary, '*', '/', '%')

  private unary = (): Expr => {
    if (this.isOp('!', '-')) {
      const op = this.peek.value as '!' | '-'
      this.at += 1
      return { t: 'unary', op, arg: this.unary() }
    }
    return this.postfix()
  }

  private postfix(): Expr {
    let expr = this.primary()
    for (;;) {
      if (this.isOp('.')) {
        this.at += 1
        if (this.peek.type !== 'id') throw new ParseError('Expected a name after "."', this.peek.pos)
        expr = { t: 'member', obj: expr, prop: this.peek.value }
        this.at += 1
      } else if (this.isOp('[')) {
        this.at += 1
        const idx = this.or()
        this.expectOp(']')
        expr = { t: 'index', obj: expr, idx }
      } else if (this.isOp('(')) {
        this.at += 1
        const args: Expr[] = []
        if (!this.isOp(')')) {
          args.push(this.or())
          while (this.isOp(',')) {
            this.at += 1
            args.push(this.or())
          }
        }
        this.expectOp(')')
        expr = { t: 'call', callee: expr, args }
      } else {
        return expr
      }
    }
  }

  private primary(): Expr {
    const token = this.peek
    if (token.type === 'num') {
      this.at += 1
      return { t: 'lit', v: Number(token.value) }
    }
    if (token.type === 'str') {
      this.at += 1
      return { t: 'lit', v: token.value }
    }
    if (token.type === 'regex') {
      this.at += 1
      return { t: 'lit', v: { __type: 'regexp', source: token.value, flags: token.flags ?? '' } }
    }
    if (token.type === 'id') {
      this.at += 1
      if (token.value === 'true') return { t: 'lit', v: true }
      if (token.value === 'false') return { t: 'lit', v: false }
      if (token.value === 'null') return { t: 'lit', v: null }
      return { t: 'id', name: token.value }
    }
    if (this.isOp('(')) {
      this.at += 1
      const inner = this.or()
      this.expectOp(')')
      return inner
    }
    throw new ParseError('Unexpected token', token.pos)
  }
}

export function parseExpression(src: string): ParsedExpr {
  try {
    return { ok: true, expr: new Parser(tokenize(src)).parse() }
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: `${e.message} at position ${e.pos}` }
    throw e
  }
}

export function unsupportedFunctions(expr: Expr): string[] {
  const found: string[] = []
  const visit = (node: Expr): void => {
    switch (node.t) {
      case 'call': {
        const name = node.callee.t === 'id' ? node.callee.name : node.callee.t === 'member' ? node.callee.prop : null
        const known = node.callee.t === 'id' ? name !== null && name in FUNCTIONS : name !== null && KNOWN_NAMES.has(name)
        if (name !== null && !known && !found.includes(name)) found.push(name)
        if (node.callee.t === 'member') visit(node.callee.obj)
        else if (node.callee.t !== 'id') visit(node.callee)
        node.args.forEach(visit)
        break
      }
      case 'member':
        visit(node.obj)
        break
      case 'index':
        visit(node.obj)
        visit(node.idx)
        break
      case 'unary':
        visit(node.arg)
        break
      case 'bin':
        visit(node.l)
        visit(node.r)
        break
      default:
    }
  }
  visit(expr)
  return found
}

function fileRef(row: BaseRow, scope: Scope): BaseFileRef {
  return { __type: 'file', row, root: scope.root ?? '' }
}

function propsOf(row: BaseRow): Record<string, BaseValue> {
  return Object.fromEntries(Object.entries(row.properties).map(([k, v]) => [k, fromJson(v)]))
}

function fileField(file: BaseFileRef, prop: string): BaseValue {
  const { row } = file
  const path = relativePath(row.path, file.root)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  switch (prop) {
    case 'name': return name
    case 'basename': return dot > 0 ? name.slice(0, dot) : name
    case 'ext': return dot >= 0 ? name.slice(dot + 1) : ''
    case 'path': return path
    case 'folder': return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    case 'size': return row.size
    case 'ctime': return makeDate(row.ctime)
    case 'mtime': return makeDate(row.mtime)
    case 'tags': return row.tags
    case 'links': return row.links.map((l) => ({ __type: 'link' as const, path: l }))
    case 'backlinks': return row.backlinks.map((l) => ({ __type: 'link' as const, path: l }))
    case 'embeds': return []
    case 'properties': return propsOf(row)
    default: return null
  }
}

function getField(obj: BaseValue, prop: string): BaseValue {
  if (obj === null) return null
  if (isFileRef(obj)) return fileField(obj, prop)
  if (Array.isArray(obj) || typeof obj === 'string') return prop === 'length' ? obj.length : null
  if (isDate(obj)) {
    const d = new Date(obj.ms)
    const fields: Record<string, number> = {
      year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(),
      minute: d.getMinutes(), second: d.getSeconds(), millisecond: d.getMilliseconds(),
    }
    return fields[prop] ?? null
  }
  if (isDuration(obj)) {
    const units: Record<string, number> = { milliseconds: 1, seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 }
    const size = units[prop]
    return size === undefined ? null : obj.ms / size
  }
  if (typeof obj === 'object' && !('__type' in obj)) return (obj as { [key: string]: BaseValue })[prop] ?? null
  return null
}

function toDuration(v: BaseValue) {
  if (isDuration(v)) return v
  return typeof v === 'string' ? parseDuration(v) : null
}

function arithmetic(op: string, l: BaseValue, r: BaseValue): BaseValue {
  if (l === null || r === null) return null
  if (op === '+') {
    if (isDate(l)) {
      const d = toDuration(r)
      if (d) return shiftDate(l, d, 1)
    }
    if (isDuration(l) && isDuration(r)) return makeDuration(l.ms + r.ms, l.months + r.months)
    if (typeof l === 'number' && typeof r === 'number') return l + r
    if (typeof l === 'string' || typeof r === 'string') return toStr(l) + toStr(r)
    return null
  }
  if (op === '-') {
    if (isDate(l) && isDate(r)) return makeDuration(l.ms - r.ms)
    if (isDate(l)) {
      const d = toDuration(r)
      return d ? shiftDate(l, d, -1) : null
    }
    if (isDuration(l) && isDuration(r)) return makeDuration(l.ms - r.ms, l.months - r.months)
    return typeof l === 'number' && typeof r === 'number' ? l - r : null
  }
  if (isDuration(l) && typeof r === 'number' && op === '*') return makeDuration(l.ms * r, l.months * r)
  if (typeof l !== 'number' || typeof r !== 'number') return null
  if (op === '*') return l * r
  if (r === 0) return null
  return op === '/' ? l / r : l % r
}

function binary(op: string, l: BaseValue, r: BaseValue): BaseValue {
  switch (op) {
    case '==': return equals(l, r)
    case '!=': return !equals(l, r)
    case '<':
    case '>':
    case '<=':
    case '>=': {
      const order = compare(l, r)
      if (order === null) return false
      return op === '<' ? order < 0 : op === '>' ? order > 0 : op === '<=' ? order <= 0 : order >= 0
    }
    default: return arithmetic(op, l, r)
  }
}

function evalNode(expr: Expr, scope: Scope): BaseValue {
  const ctx: FnContext = { now: scope.now ?? Date.now(), root: scope.root ?? '' }
  switch (expr.t) {
    case 'lit':
      return expr.v
    case 'id':
      return evalId(expr.name, scope)
    case 'unary': {
      const v = evalNode(expr.arg, scope)
      if (expr.op === '!') return !isTruthy(v)
      return typeof v === 'number' ? -v : null
    }
    case 'bin': {
      if (expr.op === '&&') return isTruthy(evalNode(expr.l, scope)) && isTruthy(evalNode(expr.r, scope))
      if (expr.op === '||') return isTruthy(evalNode(expr.l, scope)) || isTruthy(evalNode(expr.r, scope))
      return binary(expr.op, evalNode(expr.l, scope), evalNode(expr.r, scope))
    }
    case 'member':
      if (expr.obj.t === 'id' && expr.obj.name === 'formula' && !scope.locals?.formula) {
        return evalFormula(expr.prop, scope)
      }
      return getField(evalNode(expr.obj, scope), expr.prop)
    case 'index': {
      const obj = evalNode(expr.obj, scope)
      const idx = evalNode(expr.idx, scope)
      if (Array.isArray(obj)) return typeof idx === 'number' ? (obj[idx] ?? null) : null
      return typeof idx === 'string' ? getField(obj, idx) : null
    }
    case 'call':
      return evalCall(expr, scope, ctx)
  }
}

function evalId(name: string, scope: Scope): BaseValue {
  if (scope.locals && name in scope.locals) return scope.locals[name] ?? null
  switch (name) {
    case 'file': return fileRef(scope.row, scope)
    case 'note': return propsOf(scope.row)
    case 'this':
      return scope.thisRow ? { ...propsOf(scope.thisRow), file: fileRef(scope.thisRow, scope) } : null
    case 'formula': return null
    case 'tags': return scope.row.tags
    default: return fromJson(scope.row.properties[name])
  }
}

function evalFormula(name: string, scope: Scope): BaseValue {
  const formula = scope.formulas[name]
  const stack = scope.resolving ?? []
  if (!formula || stack.includes(name)) return null
  return evalNode(formula, { ...scope, resolving: [...stack, name] })
}

function evalCall(expr: Extract<Expr, { t: 'call' }>, scope: Scope, ctx: FnContext): BaseValue {
  const { callee, args } = expr
  const values = () => args.map((a) => evalNode(a, scope))
  if (callee.t === 'id') {
    const fn = FUNCTIONS[callee.name]
    return fn && !callee.name.includes('.') ? fn(values(), null, ctx) : null
  }
  if (callee.t !== 'member') return null
  const self = evalNode(callee.obj, scope)
  const name = callee.prop
  if (self === null) return name === 'isEmpty' ? true : null
  const type = typeName(self)
  if (type === 'list' && LAZY_METHODS.has(name)) return evalLazy(name, self as BaseValue[], args, scope)
  const fn = FUNCTIONS[`${type}.${name}`] ?? FUNCTIONS[`any.${name}`]
  return fn ? fn(values(), self, ctx) : null
}

function evalLazy(name: string, list: BaseValue[], args: Expr[], scope: Scope): BaseValue {
  const body = args[0]
  if (!body) return null
  const run = (value: BaseValue, index: number, acc: BaseValue = null) =>
    evalNode(body, { ...scope, locals: { ...scope.locals, value, index, acc } })
  if (name === 'map') return list.map((v, i) => run(v, i))
  if (name === 'filter') return list.filter((v, i) => isTruthy(run(v, i)))
  const initial = args[1] ? evalNode(args[1], scope) : null
  return list.reduce<BaseValue>((acc, v, i) => run(v, i, acc), initial)
}

export function evaluate(expr: Expr, scope: Scope): BaseValue {
  try {
    return evalNode(expr, scope)
  } catch {
    return null
  }
}
