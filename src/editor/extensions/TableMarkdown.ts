import { Table } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'

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
