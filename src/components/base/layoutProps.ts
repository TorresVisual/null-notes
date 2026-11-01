import type { BaseView } from '../../lib/baseFile'
import type { ViewResult } from '../../lib/baseQuery'
import type { BaseRow } from '../../types'

// Shared by every layout (table, list, cards, kanban, map).
export interface LayoutProps {
  result: ViewResult
  rows: BaseRow[]
  view: BaseView
  onWrite: (row: BaseRow, key: string, value: unknown) => void
  onCreate: (properties: Record<string, unknown>) => void
  onOpen: (path: string) => void
}
