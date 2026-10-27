import { Table } from '@tiptap/extension-table'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'

// Spreadsheet and web HTML tables mark their first row with <td>, but a saved
// GFM table always treats row 0 as the header — promote it on paste so the
// editor shows what the file will say.
function promoteHeaderRow(table: PMNode, schema: Schema): PMNode {
  const header = schema.nodes['tableHeader']
  const first = table.firstChild
  if (!header || !first || first.firstChild?.type === header) return table
  const cells: PMNode[] = []
  first.forEach((cell) => cells.push(header.create(cell.attrs, cell.content, cell.marks)))
  const rows: PMNode[] = [first.copy(Fragment.from(cells))]
  table.forEach((row, _offset, i) => {
    if (i > 0) rows.push(row)
  })
  return table.copy(Fragment.from(rows))
}

function promoteHeaderRows(fragment: Fragment, schema: Schema): Fragment {
  const nodes: PMNode[] = []
  fragment.forEach((node) => {
    nodes.push(node.type.name === 'table' ? promoteHeaderRow(node, schema) : node.copy(promoteHeaderRows(node.content, schema)))
  })
  return Fragment.from(nodes)
}

// GFM column alignment survives a save/reload round trip through the
// delimiter row alone (`:---`, `:---:`, `---:`) — the cell text itself
// carries no marker. Parsing needs no extra code: markdown-it already
// stamps `style="text-align:…"` on parsed <th>/<td> for an aligned column,
// and TableCell/TableHeader's built-in `align` attribute already reads that
// style on parseHTML. Only serialize is missing it — the bundled fallback
// this extends (tiptap-markdown's own Table storage, used because the stock
// @tiptap/extension-table defines no addStorage().markdown) writes a plain
// "---" for every column regardless of attrs.
function delimiterFor(align: string | null): string {
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  if (align === 'left') return ':---'
  return '---'
}

interface MarkdownState {
  write: (text: string) => void
  ensureNewLine: () => void
  closeBlock: (node: PMNode) => void
  renderInline: (node: PMNode) => void
  inTable: boolean
}

export const TableMarkdown = Table.extend({
  addProseMirrorPlugins() {
    const { schema } = this.editor
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        props: {
          // A partly-selected table (openStart > 0) pastes into existing cells
          // and has no header of its own to promote.
          transformPasted: (slice) =>
            slice.openStart === 0 ? new Slice(promoteHeaderRows(slice.content, schema), slice.openStart, slice.openEnd) : slice,
        },
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(rawState: Record<string, unknown>, node: PMNode) {
          const state = rawState as unknown as MarkdownState
          state.inTable = true
          node.forEach((row, _rowOffset, rowIndex) => {
            state.write('| ')
            row.forEach((cell, _cellOffset, colIndex) => {
              if (colIndex) state.write(' | ')
              const content = cell.firstChild
              if (content && content.content.size > 0) {
                state.renderInline(content)
              }
            })
            state.write(' |')
            state.ensureNewLine()
            if (rowIndex === 0) {
              const delimiters: string[] = []
              row.forEach((cell) => delimiters.push(delimiterFor((cell.attrs['align'] as string | null) ?? null)))
              state.write(`| ${delimiters.join(' | ')} |`)
              state.ensureNewLine()
            }
          })
          state.closeBlock(node)
          state.inTable = false
        },
        parse: {
          // handled by markdown-it — see comment above.
        },
      },
    }
  },
})
