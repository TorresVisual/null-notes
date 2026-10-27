import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'

// Every operation rebuilds the whole table node in one transaction, so a
// single undo restores the previous order. Alignment lives on the cells, so
// moving or copying a cell moves or copies its column's alignment with it.

function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((child) => out.push(child))
  return out
}

function moved<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice()
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

function replaceTable(editor: Editor, tablePos: number, table: PMNode, rows: PMNode[]): void {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(tablePos, tablePos + table.nodeSize, table.copy(Fragment.from(rows)))
      return true
    })
    .run()
}

function mapCells(table: PMNode, fn: (cells: PMNode[]) => PMNode[]): PMNode[] {
  return childrenOf(table).map((row) => row.copy(Fragment.from(fn(childrenOf(row)))))
}

// The header row is row 0 and never moves, so row targets below 1 are refused.
export function moveRow(editor: Editor, tablePos: number, table: PMNode, from: number, to: number): void {
  if (from < 1 || to < 1 || from === to || from >= table.childCount || to >= table.childCount) return
  replaceTable(editor, tablePos, table, moved(childrenOf(table), from, to))
}

// The first row is the GFM header, so a row inserted above it becomes the new
// header and the old one drops to a body row (prosemirror-tables would add a
// plain row above a still-header row instead).
export function insertRowAboveHeader(editor: Editor, tablePos: number, table: PMNode): void {
  const { tableHeader, tableCell } = table.type.schema.nodes
  const oldHeader = table.firstChild
  if (!tableHeader || !tableCell || !oldHeader) return
  const header = oldHeader.copy(
    Fragment.from(childrenOf(oldHeader).map((cell) => tableHeader.createAndFill({ ...cell.attrs, colspan: 1, rowspan: 1 }) as PMNode)),
  )
  const body = oldHeader.copy(
    Fragment.from(childrenOf(oldHeader).map((cell) => tableCell.create(cell.attrs, cell.content, cell.marks))),
  )
  replaceTable(editor, tablePos, table, [header, body, ...childrenOf(table).slice(1)])
}

export function duplicateRow(editor: Editor, tablePos: number, table: PMNode, row: number): void {
  if (row < 1 || row >= table.childCount) return
  const rows = childrenOf(table)
  rows.splice(row + 1, 0, rows[row] as PMNode)
  replaceTable(editor, tablePos, table, rows)
}

export function moveColumn(editor: Editor, tablePos: number, table: PMNode, from: number, to: number): void {
  const cols = table.firstChild?.childCount ?? 0
  if (from === to || from < 0 || to < 0 || from >= cols || to >= cols) return
  replaceTable(editor, tablePos, table, mapCells(table, (cells) => moved(cells, from, to)))
}

export function duplicateColumn(editor: Editor, tablePos: number, table: PMNode, col: number): void {
  replaceTable(
    editor,
    tablePos,
    table,
    mapCells(table, (cells) => {
      const next = cells.slice()
      next.splice(col + 1, 0, cells[col] as PMNode)
      return next
    }),
  )
}

// An inline-math cell has no textContent (its latex is an attribute), so read
// leaves explicitly or a math-only cell would sort as empty.
function cellText(cell: PMNode): string {
  return cell.textBetween(0, cell.content.size, ' ', (leaf) => String(leaf.attrs['latex'] ?? '')).trim()
}

export type SortDirection = 'asc' | 'desc'

// Numeric when every non-empty cell parses as a number, else case-insensitive
// text. Empty cells sort last in both directions. Array#sort is stable.
export function sortBodyRows(body: PMNode[], col: number, direction: SortDirection): PMNode[] {
  const keyed = body.map((row) => ({ row, key: cellText(row.child(col)) }))
  const numeric = keyed.every(({ key }) => key === '' || Number.isFinite(Number(key)))
  const sign = direction === 'asc' ? 1 : -1
  keyed.sort((a, b) => {
    if (a.key === '' || b.key === '') return Number(a.key === '') - Number(b.key === '')
    const order = numeric ? Number(a.key) - Number(b.key) : a.key.localeCompare(b.key, undefined, { sensitivity: 'base' })
    return order * sign
  })
  return keyed.map(({ row }) => row)
}

export function sortByColumn(editor: Editor, tablePos: number, table: PMNode, col: number, direction: SortDirection): void {
  const [header, ...body] = childrenOf(table)
  if (!header) return
  replaceTable(editor, tablePos, table, [header, ...sortBodyRows(body, col, direction)])
}

// Gap index (0..n) a pointer would drop into: how many item midpoints it has
// passed. `min` keeps rows from dropping above the header.
export function gapIndex(mids: number[], pointer: number, min = 0): number {
  return Math.max(min, mids.filter((mid) => mid < pointer).length)
}

// Final index of the moved item once removed from `from` and inserted at `gap`.
export function gapToTarget(gap: number, from: number): number {
  return gap > from ? gap - 1 : gap
}
