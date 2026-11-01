import type { BaseRow } from '../types'
import type { BaseFile, BaseView } from './baseFile'
import { evaluate, parseExpression, unsupportedFunctions } from './baseExpr'
import type { Expr, Scope } from './baseExpr'
import { compare, equals, isTruthy, toStr } from './baseValue'
import type { BaseValue } from './baseValue'

export interface ViewColumn {
  id: string
  label: string
}

export interface ViewGroup {
  key: BaseValue
  label: string
  rows: BaseRow[]
}

export interface ViewResult {
  columns: ViewColumn[]
  groups: ViewGroup[]
  errors: string[]
  unsupported: string[]
  /** Value of one column for one row, for the layouts to render. */
  cell: (row: BaseRow, columnId: string) => BaseValue
}

export interface RunOptions {
  root?: string
  now?: number
}

type Predicate = (scope: Scope) => boolean

const NO_VALUE = 'No value'
const DEFAULT_EXTRA_COLUMNS = 5

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class Collector {
  errors: string[] = []
  unsupported: string[] = []

  expression(src: string, context: string): Expr | null {
    const parsed = parseExpression(src)
    if (!parsed.ok) {
      this.errors.push(`${context} "${src}": ${parsed.error}`)
      return null
    }
    for (const name of unsupportedFunctions(parsed.expr)) {
      if (!this.unsupported.includes(name)) this.unsupported.push(name)
    }
    return parsed.expr
  }

  // A filter we cannot evaluate (bad syntax, unknown function) is skipped, not
  // applied: dropping every row because of one unsupported function would hide
  // data the user can still see in the file.
  filter(node: unknown): Predicate | null {
    if (typeof node === 'string') {
      const expr = this.expression(node, 'Filter')
      if (!expr || unsupportedFunctions(expr).length > 0) return null
      return (scope) => isTruthy(evaluate(expr, scope))
    }
    if (!isRecord(node)) return null
    const group = (key: string) =>
      asArray(node[key])
        .map((child) => this.filter(child))
        .filter((p): p is Predicate => p !== null)
    if ('and' in node) {
      const parts = group('and')
      return (scope) => parts.every((p) => p(scope))
    }
    if ('or' in node) {
      const parts = group('or')
      return parts.length === 0 ? null : (scope) => parts.some((p) => p(scope))
    }
    if ('not' in node) {
      const parts = group('not')
      return (scope) => !parts.some((p) => p(scope))
    }
    return null
  }
}

function labelFor(id: string, base: BaseFile): string {
  const named = base.properties?.[id]?.displayName ?? base.properties?.[id.replace(/^note\./, '')]?.displayName
  if (named) return named
  if (id === 'file.name') return 'Name'
  if (id.startsWith('file.')) return id.slice(5).charAt(0).toUpperCase() + id.slice(6)
  return id.replace(/^(note|formula)\./, '')
}

function defaultColumns(rows: BaseRow[]): string[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const key of Object.keys(row.properties)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const keys = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key)
  return ['file.name', ...keys.slice(0, DEFAULT_EXTRA_COLUMNS)]
}

function emptyResult(error: string): ViewResult {
  return { columns: [], groups: [], errors: [error], unsupported: [], cell: () => null }
}

interface SortKey {
  expr: Expr
  sign: 1 | -1
}

export function runView(
  base: BaseFile,
  viewIndex: number,
  rows: BaseRow[],
  thisRow: BaseRow | null,
  options: RunOptions = {},
): ViewResult {
  const view: BaseView | undefined = base.views[viewIndex]
  if (!view) return emptyResult(`This base has no view number ${viewIndex + 1}`)

  const collector = new Collector()
  const formulas: Record<string, Expr> = {}
  for (const [name, src] of Object.entries(base.formulas ?? {})) {
    const expr = collector.expression(String(src), `Formula ${name}`)
    if (expr) formulas[name] = expr
  }
  const scopeFor = (row: BaseRow): Scope => ({ row, thisRow, formulas, root: options.root, now: options.now })
  const valueOf = (expr: Expr, row: BaseRow) => evaluate(expr, scopeFor(row))

  const predicates = [base.filters, view.filters]
    .filter((f) => f !== undefined && f !== null)
    .map((f) => collector.filter(f))
    .filter((p): p is Predicate => p !== null)
  let matching = rows.filter((row) => predicates.every((p) => p(scopeFor(row))))

  const sortKeys: SortKey[] = asArray(view.sort).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.property !== 'string') return []
    const expr = collector.expression(entry.property, 'Sort')
    return expr ? [{ expr, sign: entry.direction === 'DESC' ? (-1 as const) : (1 as const) }] : []
  })
  if (sortKeys.length > 0) {
    const keyed = matching.map((row) => ({ row, keys: sortKeys.map((k) => valueOf(k.expr, row)) }))
    keyed.sort((a, b) => {
      for (const [i, key] of sortKeys.entries()) {
        const [x, y] = [a.keys[i] ?? null, b.keys[i] ?? null]
        if (x === null || y === null) {
          if (x !== y) return x === null ? 1 : -1
          continue
        }
        const order = compare(x, y) ?? 0
        if (order !== 0) return order * key.sign
      }
      return 0
    })
    matching = keyed.map((k) => k.row)
  }
  if (typeof view.limit === 'number') matching = matching.slice(0, view.limit)

  const columnIds = asArray(view.order).filter((id): id is string => typeof id === 'string')
  const ids = columnIds.length > 0 ? columnIds : defaultColumns(matching)
  const columnExprs = new Map<string, Expr | null>()
  for (const id of ids) columnExprs.set(id, collector.expression(id, 'Column'))

  const cell = (row: BaseRow, columnId: string): BaseValue => {
    const expr = columnExprs.get(columnId) ?? parseExpression(columnId)
    if ('ok' in expr) return expr.ok ? valueOf(expr.expr, row) : null
    return valueOf(expr, row)
  }

  return {
    columns: ids.map((id) => ({ id, label: labelFor(id, base) })),
    groups: groupRows(view, matching, collector, valueOf),
    errors: collector.errors,
    unsupported: collector.unsupported,
    cell,
  }
}

function groupRows(
  view: BaseView,
  rows: BaseRow[],
  collector: Collector,
  valueOf: (expr: Expr, row: BaseRow) => BaseValue,
): ViewGroup[] {
  const spec = view.groupBy
  const property = isRecord(spec) && typeof spec.property === 'string' ? spec.property : null
  const expr = property ? collector.expression(property, 'Group') : null
  if (!expr) return [{ key: null, label: '', rows }]

  const groups: ViewGroup[] = []
  const place = (key: BaseValue, row: BaseRow | null) => {
    let group = groups.find((g) => equals(g.key, key))
    if (!group) {
      group = { key, label: key === null ? NO_VALUE : toStr(key), rows: [] }
      groups.push(group)
    }
    if (row) group.rows.push(row)
  }
  for (const row of rows) {
    const value = valueOf(expr, row)
    const keys = Array.isArray(value) ? value : [value]
    const present = keys.filter((k) => k !== null && k !== '')
    if (present.length === 0) place(null, row)
    else present.forEach((key) => place(key, row))
  }

  const sign = isRecord(spec) && spec.direction === 'DESC' ? -1 : 1
  const listed = asArray(view.groupOrder).map((k) => (k === null ? null : (k as BaseValue)))
  const rank = (g: ViewGroup) => listed.findIndex((k) => equals(k, g.key))
  for (const key of listed) {
    if (key !== null && !groups.some((g) => equals(g.key, key))) place(key, null)
  }
  return groups.sort((a, b) => {
    if (a.key === null || b.key === null) return a.key === b.key ? 0 : a.key === null ? 1 : -1
    const [ra, rb] = [rank(a), rank(b)]
    if (ra !== -1 || rb !== -1) return ra === -1 ? 1 : rb === -1 ? -1 : ra - rb
    return (compare(a.key, b.key) ?? 0) * sign
  })
}
