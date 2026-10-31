export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'datetime' | 'list'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

function isCalendarDate(value: string): boolean {
  const day = value.slice(0, 10)
  const parsed = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day)
}

export function inferType(value: unknown): PropertyType {
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'string') {
    if (DATE.test(value) && isCalendarDate(value)) return 'date'
    if (DATETIME.test(value) && isCalendarDate(value)) return 'datetime'
  }
  return 'text'
}
