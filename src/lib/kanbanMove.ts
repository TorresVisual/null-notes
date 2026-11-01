import { isDate, isLink, toStr } from './baseValue'
import type { BaseValue } from './baseValue'

// A column key is a BaseValue (dates and links are objects); the file stores text.
export function toPropertyValue(key: BaseValue): unknown {
  if (key === null) return undefined
  if (isDate(key)) return toStr(key)
  if (isLink(key)) return `[[${key.path}]]`
  return key
}

/**
 * The new value of the grouped property after a card moves between columns.
 * A scalar becomes the target; in a list only the dragged value is replaced.
 * Dropping on "No value" (null) clears it; `undefined` means "remove the key".
 */
export function kanbanMove(current: unknown, fromKey: BaseValue, toKey: BaseValue): unknown {
  const target = toPropertyValue(toKey)
  if (!Array.isArray(current)) return target

  const source = toPropertyValue(fromKey)
  const index = source === undefined ? -1 : current.indexOf(source)
  const next = [...current]
  if (target === undefined || next.includes(target)) {
    if (index >= 0) next.splice(index, 1)
  } else if (index >= 0) {
    next[index] = target
  } else {
    next.push(target)
  }
  return next.length > 0 ? next : undefined
}
