import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'

interface TableInfo {
  pos: number
  node: PMNode
}

function findTables(doc: PMNode): TableInfo[] {
  const tables: TableInfo[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      tables.push({ pos, node })
      return false
    }
    return true
  })
  return tables
}

// `map.positionAt` is relative to the table's own content; +1 steps past the
// table node's own opening token into that content.
function cellPos(tablePos: number, table: PMNode, row: number, col: number): number {
  return tablePos + 1 + TableMap.get(table).positionAt(row, col, table)
}

type Chain = ReturnType<Editor['chain']>

// Every grip action needs the selection parked on a specific cell first —
// the underlying prosemirror-tables commands (addColumnBefore, deleteRow,
// ...) all read the target row/column off the current CellSelection rather
// than taking an index argument.
function runAtCell(editor: Editor, pos: number, run: (chain: Chain) => Chain): void {
  run(editor.chain().focus().setCellSelection({ anchorCell: pos, headCell: pos })).run()
}

type Align = 'left' | 'center' | 'right' | null

// Skips the redundant fourth state — an explicit 'left' renders identically
// to the unset default, so a null <-> 'left' <-> 'center' <-> 'right' cycle
// would show two visually identical steps.
function nextAlign(current: Align): Align {
  if (current === null) return 'center'
  if (current === 'center') return 'right'
  return null
}

function alignGlyph(align: Align): string {
  if (align === 'center') return 'C'
  if (align === 'right') return 'R'
  return 'L'
}

// A CellSelection spanning the top and bottom cell of a column covers every
// cell between them, so setCellAttribute (which applies to a whole
// CellSelection via forEachCell) lands on the entire column in one dispatch.
function setColumnAlign(editor: Editor, tablePos: number, table: PMNode, col: number, align: Align): void {
  const top = cellPos(tablePos, table, 0, col)
  const bottom = cellPos(tablePos, table, table.childCount - 1, col)
  editor
    .chain()
    .focus()
    .setCellSelection({ anchorCell: top, headCell: bottom })
    .setCellAttribute('align', align)
    .run()
}

function button(className: string, label: string, glyph: string, onActivate: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.setAttribute('aria-label', label)
  el.title = label
  el.textContent = glyph
  // mousedown + preventDefault (not click) so the browser never moves focus
  // or the DOM selection out of the table before the handler runs.
  el.addEventListener('mousedown', (event) => {
    event.preventDefault()
    onActivate()
  })
  return el
}

function buildRowGrip(
  index: number,
  insertLabel: string,
  deleteLabel: string,
  onInsert: () => void,
  onDelete: () => void,
): HTMLDivElement {
  const grip = document.createElement('div')
  grip.className = 'table-row-grip'
  grip.dataset.rowIndex = String(index)
  grip.appendChild(button('table-grip-insert', insertLabel, '+', onInsert))
  grip.appendChild(button('table-grip-delete', deleteLabel, '×', onDelete))
  return grip
}

function buildColumnGrip(
  index: number,
  align: Align,
  insertLabel: string,
  deleteLabel: string,
  onInsert: () => void,
  onDelete: () => void,
  onCycleAlign: () => void,
): HTMLDivElement {
  const grip = document.createElement('div')
  grip.className = 'table-col-grip'
  grip.dataset.colIndex = String(index)
  grip.appendChild(button('table-grip-insert', insertLabel, '+', onInsert))
  grip.appendChild(button('table-grip-align', `Cycle alignment (currently ${align ?? 'default'})`, alignGlyph(align), onCycleAlign))
  grip.appendChild(button('table-grip-delete', deleteLabel, '×', onDelete))
  return grip
}

function positionGrips(wrapper: HTMLElement, controls: HTMLElement): void {
  const wrapperRect = wrapper.getBoundingClientRect()
  const firstRow = wrapper.querySelector(':scope > table > tbody > tr:first-child')
  const cells = firstRow ? Array.from(firstRow.children) : []

  controls.querySelectorAll('.table-col-grip').forEach((grip, i) => {
    const cell = cells[i]
    if (!(grip instanceof HTMLElement) || !(cell instanceof HTMLElement)) return
    const r = cell.getBoundingClientRect()
    grip.style.left = `${r.left - wrapperRect.left}px`
    grip.style.width = `${r.width}px`
  })
  const lastCell = cells[cells.length - 1]
  const appendCol = controls.querySelector('.table-col-append')
  if (appendCol instanceof HTMLElement && lastCell instanceof HTMLElement) {
    const r = lastCell.getBoundingClientRect()
    appendCol.style.left = `${r.right - wrapperRect.left}px`
  }

  const rows = Array.from(wrapper.querySelectorAll(':scope > table > tbody > tr'))
  controls.querySelectorAll('.table-row-grip').forEach((grip, i) => {
    const cell = rows[i]?.firstElementChild
    if (!(grip instanceof HTMLElement) || !(cell instanceof HTMLElement)) return
    const r = cell.getBoundingClientRect()
    grip.style.top = `${r.top - wrapperRect.top}px`
    grip.style.height = `${r.height}px`
  })
  const lastRowCell = rows[rows.length - 1]?.firstElementChild
  const appendRow = controls.querySelector('.table-row-append')
  if (appendRow instanceof HTMLElement && lastRowCell instanceof HTMLElement) {
    const r = lastRowCell.getBoundingClientRect()
    appendRow.style.top = `${r.bottom - wrapperRect.top}px`
  }
}

function buildControls(editor: Editor, wrapper: HTMLElement, tablePos: number, table: PMNode): void {
  wrapper.querySelector(':scope > .table-controls')?.remove()

  const rows = table.childCount
  const cols = table.firstChild?.childCount ?? 0
  if (rows === 0 || cols === 0) return

  const controls = document.createElement('div')
  controls.className = 'table-controls'
  controls.contentEditable = 'false'

  controls.appendChild(
    button('table-controls-corner', 'Delete table', '⌧', () => {
      runAtCell(editor, cellPos(tablePos, table, 0, 0), (c) => c.deleteTable())
    }),
  )

  const colBar = document.createElement('div')
  colBar.className = 'table-col-grips'
  for (let col = 0; col < cols; col++) {
    const headerCell = table.firstChild!.child(col)
    const align = ((headerCell.attrs['align'] as Align | undefined) ?? null) as Align
    colBar.appendChild(
      buildColumnGrip(
        col,
        align,
        `Insert column before ${col + 1}`,
        `Delete column ${col + 1}`,
        () => runAtCell(editor, cellPos(tablePos, table, 0, col), (c) => c.addColumnBefore()),
        () => runAtCell(editor, cellPos(tablePos, table, 0, col), (c) => c.deleteColumn()),
        () => setColumnAlign(editor, tablePos, table, col, nextAlign(align)),
      ),
    )
  }
  colBar.appendChild(
    button('table-col-append', 'Add column', '+', () => {
      runAtCell(editor, cellPos(tablePos, table, 0, cols - 1), (c) => c.addColumnAfter())
    }),
  )
  controls.appendChild(colBar)

  const rowBar = document.createElement('div')
  rowBar.className = 'table-row-grips'
  for (let row = 0; row < rows; row++) {
    rowBar.appendChild(
      buildRowGrip(
        row,
        `Insert row before ${row + 1}`,
        `Delete row ${row + 1}`,
        () => runAtCell(editor, cellPos(tablePos, table, row, 0), (c) => c.addRowBefore()),
        () => runAtCell(editor, cellPos(tablePos, table, row, 0), (c) => c.deleteRow()),
      ),
    )
  }
  rowBar.appendChild(
    button('table-row-append', 'Add row', '+', () => {
      runAtCell(editor, cellPos(tablePos, table, rows - 1, 0), (c) => c.addRowAfter())
    }),
  )
  controls.appendChild(rowBar)

  wrapper.appendChild(controls)
  positionGrips(wrapper, controls)
}

function renderAllTableControls(editor: Editor, view: EditorView): void {
  const tables = findTables(view.state.doc)
  const wrappersInUse = new Set<HTMLElement>()

  for (const { pos, node } of tables) {
    const dom = view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) continue
    wrappersInUse.add(dom)
    buildControls(editor, dom, pos, node)
  }

  // A table that just got deleted leaves its old wrapper's controls behind
  // until the next full render replaces the DOM node entirely — nothing to
  // clean up here since ProseMirror discards the whole wrapper in that case.
  void wrappersInUse
}

export const TableControls = Extension.create({
  name: 'tableControls',

  addProseMirrorPlugins() {
    const { editor } = this

    return [
      new Plugin({
        view(editorView) {
          renderAllTableControls(editor, editorView)
          const onResize = () => renderAllTableControls(editor, editorView)
          window.addEventListener('resize', onResize)
          return {
            update(view, prevState) {
              if (!view.state.doc.eq(prevState.doc)) {
                renderAllTableControls(editor, view)
              }
            },
            destroy() {
              window.removeEventListener('resize', onResize)
            },
          }
        },
      }),
    ]
  },
})
