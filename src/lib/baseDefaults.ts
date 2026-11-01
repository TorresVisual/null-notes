import type { BaseFile, BaseView } from './baseFile'

export interface CreateDefaults {
  folder: string | null
  properties: Record<string, unknown>
}

const IN_FOLDER = /^\s*file\.inFolder\(\s*(["'])(.*?)\1\s*\)\s*$/
const EQUALS = /^\s*(?:note\.)?([\w-]+)\s*==\s*(.+?)\s*$/

function literal(text: string): unknown {
  const quoted = /^(["'])(.*)\1$/.exec(text)
  if (quoted) return quoted[2]
  if (text === 'true') return true
  if (text === 'false') return false
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : undefined
}

// Only statements that must hold for every row (top level and `and` groups) say
// anything about what a new row looks like; `or` / `not` do not.
function statements(filter: unknown): string[] {
  if (typeof filter === 'string') return [filter]
  if (typeof filter !== 'object' || filter === null || !('and' in filter)) return []
  const children = (filter as { and: unknown }).and
  return Array.isArray(children) ? children.flatMap(statements) : []
}

export function createDefaults(base: BaseFile, view: BaseView): CreateDefaults {
  const result: CreateDefaults = { folder: null, properties: {} }
  for (const statement of [...statements(base.filters), ...statements(view.filters)]) {
    const folder = IN_FOLDER.exec(statement)
    if (folder) {
      result.folder = folder[2] ?? null
      continue
    }
    const equals = EQUALS.exec(statement)
    const value = equals ? literal(equals[2] ?? '') : undefined
    if (equals?.[1] && value !== undefined) result.properties[equals[1]] = value
  }
  return result
}
