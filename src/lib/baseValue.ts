import type { BaseRow } from '../types'

export interface BaseDate {
  __type: 'date'
  ms: number
  hasTime: boolean
}
export interface BaseDuration {
  __type: 'duration'
  ms: number
  months: number
}
export interface BaseLink {
  __type: 'link'
  path: string
  display?: string
}
export interface BaseRegExp {
  __type: 'regexp'
  source: string
  flags: string
}
export interface BaseFileRef {
  __type: 'file'
  row: BaseRow
  root: string
}

export type BaseValue =
  | null
  | boolean
  | number
  | string
  | BaseDate
  | BaseDuration
  | BaseLink
  | BaseRegExp
  | BaseFileRef
  | BaseValue[]
  | { [key: string]: BaseValue }

const DAY_MS = 86_400_000
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
const WIKILINK = /^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function tagOf(value: BaseValue): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const tag = (value as { __type?: unknown }).__type
  return typeof tag === 'string' ? tag : null
}

export const isDate = (v: BaseValue): v is BaseDate => tagOf(v) === 'date'
export const isDuration = (v: BaseValue): v is BaseDuration => tagOf(v) === 'duration'
export const isLink = (v: BaseValue): v is BaseLink => tagOf(v) === 'link'
export const isRegExp = (v: BaseValue): v is BaseRegExp => tagOf(v) === 'regexp'
export const isFileRef = (v: BaseValue): v is BaseFileRef => tagOf(v) === 'file'

export function typeName(value: BaseValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'object') return tagOf(value) ?? 'object'
  return typeof value
}

export function makeDate(ms: number, hasTime = true): BaseDate {
  return { __type: 'date', ms, hasTime }
}

export function makeDuration(ms: number, months = 0): BaseDuration {
  return { __type: 'duration', ms, months }
}

export function parseDateString(text: string): BaseDate | null {
  const day = DATE.exec(text)
  const time = day ? null : DATETIME.exec(text)
  const m = day ?? time
  if (!m) return null
  const [year, month, date] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const [hour, minute, second] = time ? [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)] : [0, 0, 0]
  const d = new Date(year, month - 1, date, hour, minute, second)
  const valid = d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === date
  return valid ? makeDate(d.getTime(), time !== null) : null
}

export function fromJson(value: unknown): BaseValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    const link = WIKILINK.exec(value)
    if (link) return { __type: 'link', path: link[1] ?? '', display: link[2] }
    return parseDateString(value) ?? value
  }
  if (Array.isArray(value)) return value.map(fromJson)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromJson(v)]))
  }
  return null
}

export function isTruthy(value: BaseValue): boolean {
  if (value === null) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

export function formatDate(date: BaseDate, format: string): string {
  const d = new Date(date.ms)
  const hour12 = d.getHours() % 12 || 12
  const tokens: Record<string, string> = {
    YYYY: pad(d.getFullYear(), 4),
    YY: pad(d.getFullYear() % 100),
    MMMM: MONTHS[d.getMonth()] ?? '',
    MMM: (MONTHS[d.getMonth()] ?? '').slice(0, 3),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
    dddd: WEEKDAYS[d.getDay()] ?? '',
    ddd: (WEEKDAYS[d.getDay()] ?? '').slice(0, 3),
    HH: pad(d.getHours()),
    H: String(d.getHours()),
    hh: pad(hour12),
    h: String(hour12),
    mm: pad(d.getMinutes()),
    m: String(d.getMinutes()),
    ss: pad(d.getSeconds()),
    s: String(d.getSeconds()),
    A: d.getHours() < 12 ? 'AM' : 'PM',
    a: d.getHours() < 12 ? 'am' : 'pm',
  }
  return format.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g,
    (token, literal: string | undefined) => literal ?? tokens[token] ?? token,
  )
}

const UNITS: Record<string, { ms: number; months: number }> = {
  y: { ms: 0, months: 12 }, year: { ms: 0, months: 12 }, years: { ms: 0, months: 12 },
  M: { ms: 0, months: 1 }, month: { ms: 0, months: 1 }, months: { ms: 0, months: 1 },
  w: { ms: 7 * DAY_MS, months: 0 }, week: { ms: 7 * DAY_MS, months: 0 }, weeks: { ms: 7 * DAY_MS, months: 0 },
  d: { ms: DAY_MS, months: 0 }, day: { ms: DAY_MS, months: 0 }, days: { ms: DAY_MS, months: 0 },
  h: { ms: 3_600_000, months: 0 }, hour: { ms: 3_600_000, months: 0 }, hours: { ms: 3_600_000, months: 0 },
  m: { ms: 60_000, months: 0 }, min: { ms: 60_000, months: 0 }, minute: { ms: 60_000, months: 0 }, minutes: { ms: 60_000, months: 0 },
  s: { ms: 1000, months: 0 }, sec: { ms: 1000, months: 0 }, second: { ms: 1000, months: 0 }, seconds: { ms: 1000, months: 0 },
}

export function parseDuration(text: string): BaseDuration | null {
  const part = /(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)/y
  let ms = 0
  let months = 0
  let found = false
  let index = 0
  const source = text.trim()
  while (index < source.length) {
    part.lastIndex = index
    const m = part.exec(source)
    const unit = m ? UNITS[m[2] ?? ''] : undefined
    if (!m || !unit) return null
    ms += Number(m[1]) * unit.ms
    months += Number(m[1]) * unit.months
    found = true
    index = part.lastIndex
    while (source[index] === ' ' || source[index] === ',') index += 1
  }
  return found ? makeDuration(ms, months) : null
}

// Month arithmetic clamps to the last day (Jan 31 + 1M = Feb 28), like Obsidian.
export function shiftDate(date: BaseDate, duration: BaseDuration, sign: 1 | -1): BaseDate {
  const d = new Date(date.ms)
  if (duration.months !== 0) {
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + sign * duration.months)
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, lastDay))
  }
  return makeDate(d.getTime() + sign * duration.ms, date.hasTime)
}

export function toStr(value: BaseValue): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(toStr).join(', ')
  switch (tagOf(value)) {
    case 'date':
      return formatDate(value as BaseDate, (value as BaseDate).hasTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD')
    case 'link':
      return (value as BaseLink).display ?? (value as BaseLink).path
    case 'regexp':
      return `/${(value as BaseRegExp).source}/${(value as BaseRegExp).flags}`
    case 'file':
      return (value as BaseFileRef).row.path
    case 'duration':
      return `${(value as BaseDuration).ms}ms`
    default:
      return JSON.stringify(value)
  }
}

function asDate(value: BaseValue): BaseDate | null {
  if (isDate(value)) return value
  return typeof value === 'string' ? parseDateString(value) : null
}

function linkKey(value: BaseValue): string | null {
  if (isLink(value)) return value.path.toLowerCase()
  if (isFileRef(value)) return value.row.title.toLowerCase()
  return null
}

export function equals(a: BaseValue, b: BaseValue): boolean {
  if (a === null || b === null) return a === b
  const [da, db] = [asDate(a), asDate(b)]
  if ((isDate(a) || isDate(b)) && da && db) return da.ms === db.ms
  const [la, lb] = [linkKey(a), linkKey(b)]
  if (la !== null && lb !== null) return la === lb
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

// null when the two values have no order (different kinds, or a null side).
export function compare(a: BaseValue, b: BaseValue): number | null {
  if (a === null || b === null) return null
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const [da, db] = [asDate(a), asDate(b)]
  if ((isDate(a) || isDate(b)) && da && db) return da.ms - db.ms
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (isDuration(a) && isDuration(b)) return a.ms - b.ms
  return null
}
