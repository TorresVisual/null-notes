import {
  compare,
  equals,
  formatDate,
  fromJson,
  isDate,
  isFileRef,
  isLink,
  isRegExp,
  isTruthy,
  makeDate,
  parseDateString,
  parseDuration,
  toStr,
  typeName,
} from './baseValue'
import type { BaseDate, BaseValue } from './baseValue'

export interface FnContext {
  now: number
  root: string
}

export type BaseFn = (args: BaseValue[], self: BaseValue, ctx: FnContext) => BaseValue

const str = (v: BaseValue | undefined): string => (v === undefined ? '' : toStr(v))
const num = (v: BaseValue | undefined): number => (typeof v === 'number' ? v : Number.NaN)
const list = (v: BaseValue): BaseValue[] => (Array.isArray(v) ? v : [])
const selfStr = (self: BaseValue): string => toStr(self)
const selfNum = (self: BaseValue): number => (typeof self === 'number' ? self : Number.NaN)
const nanToNull = (n: number): number | null => (Number.isNaN(n) ? null : n)

function toRegExp(pattern: BaseValue | undefined, extraFlags = ''): RegExp | null {
  if (pattern !== undefined && isRegExp(pattern)) {
    try {
      return new RegExp(pattern.source, pattern.flags + extraFlags)
    } catch {
      return null
    }
  }
  return null
}

function midnight(ms: number): BaseDate {
  const d = new Date(ms)
  return makeDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), false)
}

function relative(ms: number, now: number): string {
  const diff = ms - now
  const seconds = Math.abs(diff) / 1000
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ]
  let value = seconds
  let unit = 'second'
  for (const [size, name] of units) {
    unit = name
    if (value < size) break
    value /= size
  }
  const count = Math.max(1, Math.floor(value))
  const label = `${count} ${unit}${count === 1 ? '' : 's'}`
  return diff < 0 ? `${label} ago` : `in ${label}`
}

const linkTarget = (v: BaseValue | undefined): string => {
  if (v !== undefined && isLink(v)) return v.path.toLowerCase()
  if (v !== undefined && isFileRef(v)) return v.row.title.toLowerCase()
  return str(v).replace(/^\[\[|\]\]$/g, '').replace(/\.md$/i, '').toLowerCase()
}

function relativePath(path: string, root: string): string {
  const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const [p, r] = [normalize(path), normalize(root)]
  return (r && p.startsWith(r) ? p.slice(r.length) : p).replace(/^\/+/, '')
}

function rowOf(self: BaseValue) {
  return isFileRef(self) ? self : null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export const FUNCTIONS: Record<string, BaseFn> = {
  escapeHTML: (a) => escapeHtml(str(a[0])),
  date: (a) => parseDateString(str(a[0]).trim()) ?? null,
  duration: (a) => parseDuration(str(a[0])),
  if: (a) => (isTruthy(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),
  link: (a) => {
    const target = a[0] ?? null
    if (target === null) return null
    const path = isFileRef(target) ? target.row.title : str(target)
    return { __type: 'link', path, display: a[1] === undefined ? undefined : str(a[1]) }
  },
  list: (a) => (Array.isArray(a[0]) ? a[0] : a[0] === undefined || a[0] === null ? [] : [a[0]]),
  max: (a) => Math.max(...a.filter((v): v is number => typeof v === 'number')),
  min: (a) => Math.min(...a.filter((v): v is number => typeof v === 'number')),
  now: (_a, _s, ctx) => makeDate(ctx.now, true),
  today: (_a, _s, ctx) => midnight(ctx.now),
  number: (a) => {
    const v = a[0] ?? null
    if (typeof v === 'number') return v
    if (typeof v === 'boolean') return v ? 1 : 0
    if (isDate(v)) return v.ms
    return typeof v === 'string' && v.trim() !== '' ? nanToNull(Number(v)) : null
  },
  random: () => Math.random(),
  html: (a) => str(a[0]),
  image: (a) => str(a[0]),
  icon: (a) => str(a[0]),

  'any.isTruthy': (_a, self) => isTruthy(self),
  'any.isType': (a, self) => typeName(self) === str(a[0]),
  'any.toString': (_a, self) => toStr(self),

  'date.date': (_a, self) => (isDate(self) ? midnight(self.ms) : null),
  'date.format': (a, self) => (isDate(self) ? formatDate(self, str(a[0])) : null),
  'date.time': (_a, self) => (isDate(self) ? formatDate(self, 'HH:mm:ss') : null),
  'date.relative': (_a, self, ctx) => (isDate(self) ? relative(self.ms, ctx.now) : null),
  'date.isEmpty': () => false,

  'file.asLink': (a, self) => {
    const file = rowOf(self)
    return file ? { __type: 'link', path: file.row.title, display: a[0] === undefined ? undefined : str(a[0]) } : null
  },
  'file.hasLink': (a, self) => {
    const file = rowOf(self)
    const target = linkTarget(a[0])
    return file ? file.row.links.some((l) => l.toLowerCase() === target) : false
  },
  'file.hasProperty': (a, self) => {
    const file = rowOf(self)
    return file ? Object.prototype.hasOwnProperty.call(file.row.properties, str(a[0])) : false
  },
  'file.hasTag': (a, self) => {
    const file = rowOf(self)
    if (!file) return false
    const have = file.row.tags.map((t) => t.replace(/^#/, '').toLowerCase())
    return a.some((v) => {
      const want = str(v).replace(/^#/, '').toLowerCase()
      return have.some((t) => t === want || t.startsWith(`${want}/`))
    })
  },
  'file.inFolder': (a, self) => {
    const file = rowOf(self)
    if (!file) return false
    const folder = str(a[0]).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const path = relativePath(file.row.path, file.root)
    return folder === '' || path.startsWith(`${folder}/`)
  },

  'link.asFile': () => null,
  'link.linksTo': () => false,

  'list.contains': (a, self) => list(self).some((v) => equals(v, a[0] ?? null)),
  'list.containsAll': (a, self) => a.every((x) => list(self).some((v) => equals(v, x))),
  'list.containsAny': (a, self) => a.some((x) => list(self).some((v) => equals(v, x))),
  'list.flat': (_a, self) => list(self).flatMap((v) => (Array.isArray(v) ? v : [v])),
  'list.isEmpty': (_a, self) => list(self).length === 0,
  'list.join': (a, self) => list(self).map(toStr).join(a[0] === undefined ? ',' : str(a[0])),
  'list.reverse': (_a, self) => [...list(self)].reverse(),
  'list.slice': (a, self) => list(self).slice(num(a[0]), a[1] === undefined ? undefined : num(a[1])),
  'list.sort': (_a, self) =>
    [...list(self)].sort((x, y) => (x === null ? 1 : y === null ? -1 : (compare(x, y) ?? 0))),
  'list.unique': (_a, self) => list(self).filter((v, i, all) => all.findIndex((w) => equals(v, w)) === i),

  'number.abs': (_a, self) => Math.abs(selfNum(self)),
  'number.ceil': (_a, self) => Math.ceil(selfNum(self)),
  'number.floor': (_a, self) => Math.floor(selfNum(self)),
  'number.isEmpty': () => false,
  'number.round': (a, self) => {
    const factor = 10 ** (a[0] === undefined ? 0 : num(a[0]))
    return Math.round(selfNum(self) * factor) / factor
  },
  'number.toFixed': (a, self) => selfNum(self).toFixed(a[0] === undefined ? 0 : num(a[0])),

  'object.isEmpty': (_a, self) => typeof self === 'object' && self !== null && Object.keys(self).length === 0,
  'object.keys': (_a, self) => (typeof self === 'object' && self !== null && !Array.isArray(self) ? Object.keys(self) : []),
  'object.values': (_a, self) =>
    typeof self === 'object' && self !== null && !Array.isArray(self) ? Object.values(self) : [],

  'regexp.matches': (a, self) => {
    const re = toRegExp(self)
    return re ? re.test(str(a[0])) : false
  },

  'string.contains': (a, self) => selfStr(self).includes(str(a[0])),
  'string.containsAll': (a, self) => a.every((x) => selfStr(self).includes(str(x))),
  'string.containsAny': (a, self) => a.some((x) => selfStr(self).includes(str(x))),
  'string.endsWith': (a, self) => selfStr(self).endsWith(str(a[0])),
  'string.isEmpty': (_a, self) => selfStr(self) === '',
  'string.lower': (_a, self) => selfStr(self).toLowerCase(),
  'string.replace': (a, self) => {
    const re = toRegExp(a[0])
    return re ? selfStr(self).replace(re, str(a[1])) : selfStr(self).replace(str(a[0]), str(a[1]))
  },
  'string.repeat': (a, self) => (num(a[0]) >= 0 ? selfStr(self).repeat(num(a[0])) : null),
  'string.reverse': (_a, self) => [...selfStr(self)].reverse().join(''),
  'string.slice': (a, self) => selfStr(self).slice(num(a[0]), a[1] === undefined ? undefined : num(a[1])),
  'string.split': (a, self) => {
    const re = toRegExp(a[0])
    const parts = re ? selfStr(self).split(re) : selfStr(self).split(str(a[0]))
    return a[1] === undefined ? parts : parts.slice(0, num(a[1]))
  },
  'string.startsWith': (a, self) => selfStr(self).startsWith(str(a[0])),
  'string.title': (_a, self) => selfStr(self).replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
  'string.trim': (_a, self) => selfStr(self).trim(),
}

export const LAZY_METHODS = new Set(['map', 'filter', 'reduce'])

export const KNOWN_NAMES = new Set([
  ...Object.keys(FUNCTIONS).map((k) => k.split('.').pop() ?? k),
  ...LAZY_METHODS,
])

export { fromJson, relativePath }
