import type { BaseFile } from './baseFile'
import type { BaseRow } from '../types'

const FILE_COLUMNS = ['file.name', 'file.folder', 'file.mtime', 'file.ctime', 'file.size', 'file.tags']

// Every id a column, sort or group picker can offer: file facts, then the
// property keys that occur in the rows, then the base's formulas.
export function availableColumns(base: BaseFile, rows: BaseRow[]): string[] {
  const keys = new Set<string>()
  for (const row of rows) Object.keys(row.properties).forEach((k) => keys.add(k))
  const formulas = Object.keys(base.formulas ?? {}).map((name) => `formula.${name}`)
  return [...FILE_COLUMNS, ...[...keys].sort((a, b) => a.localeCompare(b)), ...formulas]
}

const PLAIN_PROPERTY = /^(?:note\.)?([\w-]+)$/

/** The frontmatter key a column or group id names, or null when it is a file fact, formula or expression. */
export function plainPropertyKey(id: string): string | null {
  return PLAIN_PROPERTY.exec(id)?.[1] ?? null
}
