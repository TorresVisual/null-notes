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

// Every menu action needs the selection parked on a specific cell first —
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

function alignLabel(align: Align): string {
  if (align === 'center') return 'Center'
  if (align === 'right') return 'Right'
  return 'Left'
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

// Hand-drawn to match lucide-react's own SVG wrapper attributes (24x24
// viewbox, 2px round stroke) so these read as the same icon family the rest
// of the toolbar uses via lucide-react (see toolbar/InsertGroup.tsx) — this
// file builds plain DOM inside a ProseMirror plugin view, so it can't render
// React components directly.
const ICON_PLUS = '<path d="M5 12h14"/><path d="M12 5v14"/>'
const ICON_TRASH =
  '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
const ICON_ALIGN: Record<'left' | 'center' | 'right', string> = {
  left: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
  center: '<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>',
  right: '<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>',
}
const ICON_DOTS_HORIZONTAL =
  '<circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/>'
const ICON_DOTS_VERTICAL =
  '<circle cx="12" cy="6" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="18" r="1.6" fill="currentColor"/>'

function svgIcon(inner: string, stroked: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  if (stroked) {
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2.5')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
  }
  // `inner` is always one of this file's own hardcoded ICON_* constants,
  // never note-derived text.
  // eslint-disable-next-line no-unsanitized/property
  svg.innerHTML = inner
  return svg
}

function iconButton(className: string, label: string, iconInner: string, onActivate: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.setAttribute('aria-label', label)
  el.title = label
  el.appendChild(svgIcon(iconInner, true))
  // mousedown + preventDefault (not click) so the browser never moves focus
  // or the DOM selection out of the table before the handler runs.
  el.addEventListener('mousedown', (event) => {
    event.preventDefault()
    onActivate()
  })
  return el
}

function menuItem(label: string, action: string, iconInner: string, onActivate: () => void, danger = false): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.dataset.action = action
  if (danger) el.className = 'danger'
  el.appendChild(svgIcon(iconInner, true))
  el.appendChild(document.createTextNode(label))
  el.addEventListener('mousedown', (event) => {
    event.preventDefault()
    onActivate()
  })
  return el
}

// Only one grip menu open at a time, Notion-style — opening one closes any
// other already open in this table's controls.
function closeOtherMenus(container: HTMLElement, except: HTMLDetailsElement): void {
  container.querySelectorAll('details[open]').forEach((el) => {
    if (el !== except && el instanceof HTMLDetailsElement) el.open = false
  })
}

// Tints the targeted column/row with a JS-drawn overlay rather than a class
// on the th/td themselves — those are ProseMirror-owned content nodes, and
// mutating their attributes directly outside a transaction fights
// ProseMirror's own DOM reconciliation (it can resync/replace the node from
// under us). `owner` tags which menu drew the current overlay: a menu's
// close only clears it if it's still the one showing, so a delayed close
// from a menu that just lost focus (see closeOtherMenus) can't erase the
// overlay the newly-opened menu already drew this tick.
function clearHighlightIfOwner(controls: HTMLElement, owner: string): void {
  const el = controls.querySelector(':scope > .table-highlight')
  if (el instanceof HTMLElement && el.dataset.owner === owner) el.remove()
}

function showHighlight(controls: HTMLElement, owner: string, rect: { left: number; top: number; width: number; height: number }): void {
  controls.querySelector(':scope > .table-highlight')?.remove()
  const overlay = document.createElement('div')
  overlay.className = 'table-highlight'
  overlay.dataset.owner = owner
  overlay.style.left = `${rect.left}px`
  overlay.style.top = `${rect.top}px`
  overlay.style.width = `${rect.width}px`
  overlay.style.height = `${rect.height}px`
  controls.appendChild(overlay)
}

function showColumnHighlight(wrapper: HTMLElement, controls: HTMLElement, col: number): void {
  const wrapperRect = wrapper.getBoundingClientRect()
  const rects = Array.from(wrapper.querySelectorAll(':scope > table > tbody > tr'))
    .map((row) => row.children[col])
    .filter((cell): cell is HTMLElement => cell instanceof HTMLElement)
    .map((cell) => cell.getBoundingClientRect())
  if (rects.length === 0) return
  const left = Math.min(...rects.map((r) => r.left)) - wrapperRect.left
  const top = Math.min(...rects.map((r) => r.top)) - wrapperRect.top
  const right = Math.max(...rects.map((r) => r.right)) - wrapperRect.left
  const bottom = Math.max(...rects.map((r) => r.bottom)) - wrapperRect.top
  showHighlight(controls, `col-${col}`, { left, top, width: right - left, height: bottom - top })
}

function showRowHighlight(wrapper: HTMLElement, controls: HTMLElement, row: number): void {
  const wrapperRect = wrapper.getBoundingClientRect()
  const tr = wrapper.querySelectorAll(':scope > table > tbody > tr')[row]
  if (!(tr instanceof HTMLElement)) return
  const r = tr.getBoundingClientRect()
  showHighlight(controls, `row-${row}`, {
    left: r.left - wrapperRect.left,
    top: r.top - wrapperRect.top,
    width: r.width,
    height: r.height,
  })
}

function buildColumnMenu(
  editor: Editor,
  wrapper: HTMLElement,
  controls: HTMLElement,
  tablePos: number,
  table: PMNode,
  col: number,
): HTMLDetailsElement {
  const align = ((table.firstChild!.child(col).attrs['align'] as Align | undefined) ?? null) as Align

  const details = document.createElement('details')
  details.className = 'table-col-menu'
  details.dataset.colIndex = String(col)

  const summary = document.createElement('summary')
  summary.className = 'table-grip'
  summary.setAttribute('aria-label', `Column ${col + 1} options`)
  summary.appendChild(svgIcon(ICON_DOTS_HORIZONTAL, false))
  details.appendChild(summary)

  const panel = document.createElement('div')
  panel.className = 'context-menu table-menu-panel'
  panel.appendChild(
    menuItem('Insert left', 'insert-left', ICON_PLUS, () => {
      runAtCell(editor, cellPos(tablePos, table, 0, col), (c) => c.addColumnBefore())
    }),
  )
  panel.appendChild(
    menuItem('Insert right', 'insert-right', ICON_PLUS, () => {
      runAtCell(editor, cellPos(tablePos, table, 0, col), (c) => c.addColumnAfter())
    }),
  )
  panel.appendChild(
    menuItem(`Align: ${alignLabel(align)}`, 'align', ICON_ALIGN[align ?? 'left'], () => {
      setColumnAlign(editor, tablePos, table, col, nextAlign(align))
    }),
  )
  panel.appendChild(document.createElement('hr'))
  panel.appendChild(
    menuItem(
      'Delete column',
      'delete',
      ICON_TRASH,
      () => {
        runAtCell(editor, cellPos(tablePos, table, 0, col), (c) => c.deleteColumn())
      },
      true,
    ),
  )
  details.appendChild(panel)

  const owner = `col-${col}`
  details.addEventListener('toggle', () => {
    if (details.open) {
      closeOtherMenus(controls, details)
      showColumnHighlight(wrapper, controls, col)
    } else {
      clearHighlightIfOwner(controls, owner)
    }
  })

  return details
}

function buildRowMenu(
  editor: Editor,
  wrapper: HTMLElement,
  controls: HTMLElement,
  tablePos: number,
  table: PMNode,
  row: number,
): HTMLDetailsElement {
  const details = document.createElement('details')
  details.className = 'table-row-menu'
  details.dataset.rowIndex = String(row)

  const summary = document.createElement('summary')
  summary.className = 'table-grip'
  summary.setAttribute('aria-label', `Row ${row + 1} options`)
  summary.appendChild(svgIcon(ICON_DOTS_VERTICAL, false))
  details.appendChild(summary)

  const panel = document.createElement('div')
  panel.className = 'context-menu table-menu-panel'
  panel.appendChild(
    menuItem('Insert above', 'insert-above', ICON_PLUS, () => {
      runAtCell(editor, cellPos(tablePos, table, row, 0), (c) => c.addRowBefore())
    }),
  )
  panel.appendChild(
    menuItem('Insert below', 'insert-below', ICON_PLUS, () => {
      runAtCell(editor, cellPos(tablePos, table, row, 0), (c) => c.addRowAfter())
    }),
  )
  panel.appendChild(document.createElement('hr'))
  panel.appendChild(
    menuItem(
      'Delete row',
      'delete',
      ICON_TRASH,
      () => {
        runAtCell(editor, cellPos(tablePos, table, row, 0), (c) => c.deleteRow())
      },
      true,
    ),
  )
  details.appendChild(panel)

  const owner = `row-${row}`
  details.addEventListener('toggle', () => {
    if (details.open) {
      closeOtherMenus(controls, details)
      showRowHighlight(wrapper, controls, row)
    } else {
      clearHighlightIfOwner(controls, owner)
    }
  })

  return details
}

function positionGrips(wrapper: HTMLElement, controls: HTMLElement): void {
  const wrapperRect = wrapper.getBoundingClientRect()
  const firstRow = wrapper.querySelector(':scope > table > tbody > tr:first-child')
  const cells = firstRow ? Array.from(firstRow.children) : []

  controls.querySelectorAll('.table-col-menu').forEach((menu, i) => {
    const cell = cells[i]
    if (!(menu instanceof HTMLElement) || !(cell instanceof HTMLElement)) return
    const r = cell.getBoundingClientRect()
    menu.style.left = `${r.left - wrapperRect.left + r.width / 2}px`
  })

  const rows = Array.from(wrapper.querySelectorAll(':scope > table > tbody > tr'))
  controls.querySelectorAll('.table-row-menu').forEach((menu, i) => {
    const cell = rows[i]?.firstElementChild
    if (!(menu instanceof HTMLElement) || !(cell instanceof HTMLElement)) return
    const r = cell.getBoundingClientRect()
    menu.style.top = `${r.top - wrapperRect.top + r.height / 2}px`
  })
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
    iconButton('table-controls-corner', 'Delete table', ICON_TRASH, () => {
      runAtCell(editor, cellPos(tablePos, table, 0, 0), (c) => c.deleteTable())
    }),
  )

  for (let col = 0; col < cols; col++) {
    controls.appendChild(buildColumnMenu(editor, wrapper, controls, tablePos, table, col))
  }
  controls.appendChild(
    iconButton('table-append-col', 'Add column', ICON_PLUS, () => {
      runAtCell(editor, cellPos(tablePos, table, 0, cols - 1), (c) => c.addColumnAfter())
    }),
  )

  for (let row = 0; row < rows; row++) {
    controls.appendChild(buildRowMenu(editor, wrapper, controls, tablePos, table, row))
  }
  controls.appendChild(
    iconButton('table-append-row', 'Add row', ICON_PLUS, () => {
      runAtCell(editor, cellPos(tablePos, table, rows - 1, 0), (c) => c.addRowAfter())
    }),
  )

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

          // Closes any open grip menu when the user clicks outside it.
          // Capture phase so this runs before a menu item's own mousedown
          // handler; `contains` keeps a click inside an open menu from
          // closing it before that handler fires. Scoped to our own menu
          // classes so it never touches the unrelated content-level
          // <details>/<summary> the Details extension renders.
          const onOutsideClick = (event: MouseEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return
            editorView.dom.querySelectorAll('details.table-col-menu[open], details.table-row-menu[open]').forEach((el) => {
              if (el instanceof HTMLDetailsElement && !el.contains(target)) el.open = false
            })
          }
          document.addEventListener('mousedown', onOutsideClick, true)

          return {
            update(view, prevState) {
              if (!view.state.doc.eq(prevState.doc)) {
                renderAllTableControls(editor, view)
              }
            },
            destroy() {
              window.removeEventListener('resize', onResize)
              document.removeEventListener('mousedown', onOutsideClick, true)
            },
          }
        },
      }),
    ]
  },
})
