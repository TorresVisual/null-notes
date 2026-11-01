import { plainPropertyKey } from '../../lib/baseColumns'
import { inferType } from '../../lib/propertyType'
import { toStr } from '../../lib/baseValue'
import type { BaseValue } from '../../lib/baseValue'
import type { BaseRow } from '../../types'
import { PropertyValueInput } from '../PropertyValueInput'

interface PropertyCellProps {
  row: BaseRow
  columnId: string
  value: BaseValue
  onWrite: (row: BaseRow, key: string, value: unknown) => void
}

// Only a column that is exactly one frontmatter key can be edited in place;
// file facts, formulas and anything computed are read-only.
export function PropertyCell({ row, columnId, value, onWrite }: PropertyCellProps) {
  const key = plainPropertyKey(columnId)
  const editable = key !== null && (key !== 'tags' || 'tags' in row.properties)
  if (!editable) {
    return <span className="base-cell-text">{toStr(value)}</span>
  }
  const raw = row.properties[key]
  return (
    <PropertyValueInput
      key={`${key}:${JSON.stringify(raw)}`}
      name={key}
      type={inferType(raw)}
      value={raw}
      onCommit={(next) => onWrite(row, key, next)}
    />
  )
}
