import { describe, it, expect, afterEach } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { coreExtensions } from './index'

let editor: Editor | null = null

const TABLE_HTML =
  '<table><tr><th>A</th><th>B</th><th>C</th></tr>' +
  '<tr><td>1</td><td>2</td><td>3</td></tr>' +
  '<tr><td>4</td><td>5</td><td>6</td></tr></table>'

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

function findTable(e: Editor): PMNode {
  let found: PMNode | null = null
  e.state.doc.descendants((node) => {
    if (node.type.name === 'table') {
      found = node
      return false
    }
    return true
  })
  if (!found) throw new Error('no table node in document')
  return found
}

function rowTexts(row: PMNode): string[] {
  const texts: string[] = []
  row.forEach((cell) => texts.push(cell.textContent))
  return texts
}

function columnAligns(table: PMNode, col: number): (string | null)[] {
  const aligns: (string | null)[] = []
  table.forEach((row) => aligns.push((row.child(col).attrs['align'] as string | null) ?? null))
  return aligns
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

function click(selector: string, e: Editor): void {
  const el = e.view.dom.querySelector(selector)
  if (!el) throw new Error(`no element matching ${selector}`)
  fireEvent.mouseDown(el)
}

// Grip menus are native <details>/<summary> — the browser toggles `open` on
// a `click` event, not `mousedown`, so opening one needs a real click. The
// `open` property itself flips synchronously; only the resulting `toggle`
// event (which drives highlight/close-siblings, see flushToggle below) is
// deferred to a queued task per spec.
function openMenu(selector: string, e: Editor): void {
  const el = e.view.dom.querySelector(selector)
  if (!(el instanceof HTMLDetailsElement)) throw new Error(`no details matching ${selector}`)
  el.querySelector('summary')?.click()
}

function flushToggle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('table grip menus', () => {
  it('renders one column menu and one row menu per column/row', () => {
    const e = mount(TABLE_HTML)
    expect(e.view.dom.querySelectorAll('.table-col-menu').length).toBe(3)
    expect(e.view.dom.querySelectorAll('.table-row-menu').length).toBe(3)
  })

  it('renders no controls when the document has no table', () => {
    const e = mount('<p>no table here</p>')
    expect(e.view.dom.querySelectorAll('.table-controls').length).toBe(0)
  })

  it('deletes the targeted column via its menu, leaving the others in order', () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-col-menu[data-col-index="1"]', e)
    click('.table-col-menu[data-col-index="1"] [data-action="delete"]', e)
    const table = findTable(e)
    expect(table.firstChild!.childCount).toBe(2)
    expect(rowTexts(table.firstChild!)).toEqual(['A', 'C'])
  })

  it('inserts a column left of the targeted menu', () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-col-menu[data-col-index="1"]', e)
    click('.table-col-menu[data-col-index="1"] [data-action="insert-left"]', e)
    const table = findTable(e)
    expect(table.firstChild!.childCount).toBe(4)
    expect(rowTexts(table.firstChild!)).toEqual(['A', '', 'B', 'C'])
  })

  it('inserts a column right of the targeted menu', () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-col-menu[data-col-index="1"]', e)
    click('.table-col-menu[data-col-index="1"] [data-action="insert-right"]', e)
    const table = findTable(e)
    expect(table.firstChild!.childCount).toBe(4)
    expect(rowTexts(table.firstChild!)).toEqual(['A', 'B', '', 'C'])
  })

  it('appends a column at the end via the persistent append control', () => {
    const e = mount(TABLE_HTML)
    click('.table-append-col', e)
    const table = findTable(e)
    expect(table.firstChild!.childCount).toBe(4)
    expect(rowTexts(table.firstChild!)).toEqual(['A', 'B', 'C', ''])
  })

  it('deletes the targeted row via its menu, leaving the others in order', () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-row-menu[data-row-index="1"]', e)
    click('.table-row-menu[data-row-index="1"] [data-action="delete"]', e)
    const table = findTable(e)
    expect(table.childCount).toBe(2)
    expect(rowTexts(table.child(1))).toEqual(['4', '5', '6'])
  })

  it('inserts a row above the targeted menu', () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-row-menu[data-row-index="1"]', e)
    click('.table-row-menu[data-row-index="1"] [data-action="insert-above"]', e)
    const table = findTable(e)
    expect(table.childCount).toBe(4)
    expect(rowTexts(table.child(1))).toEqual(['', '', ''])
    expect(rowTexts(table.child(2))).toEqual(['1', '2', '3'])
  })

  it('inserts a row below the targeted menu', () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-row-menu[data-row-index="1"]', e)
    click('.table-row-menu[data-row-index="1"] [data-action="insert-below"]', e)
    const table = findTable(e)
    expect(table.childCount).toBe(4)
    expect(rowTexts(table.child(1))).toEqual(['1', '2', '3'])
    expect(rowTexts(table.child(2))).toEqual(['', '', ''])
  })

  it('appends a row at the end via the persistent append control', () => {
    const e = mount(TABLE_HTML)
    click('.table-append-row', e)
    const table = findTable(e)
    expect(table.childCount).toBe(4)
    expect(rowTexts(table.child(3))).toEqual(['', '', ''])
  })

  it('deletes the whole table via the corner control', () => {
    const e = mount(TABLE_HTML)
    click('.table-controls-corner', e)
    let found = false
    e.state.doc.descendants((node) => {
      if (node.type.name === 'table') found = true
      return true
    })
    expect(found).toBe(false)
  })

  it('rebuilds menus to match the new column count after a delete', () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-col-menu[data-col-index="0"]', e)
    click('.table-col-menu[data-col-index="0"] [data-action="delete"]', e)
    expect(e.view.dom.querySelectorAll('.table-col-menu').length).toBe(2)
  })

  it("cycles a column's alignment through center, right, then back to default, applied to every cell in the column", () => {
    const e = mount(TABLE_HTML)
    const selector = '.table-col-menu[data-col-index="1"] [data-action="align"]'

    openMenu('.table-col-menu[data-col-index="1"]', e)
    click(selector, e)
    expect(columnAligns(findTable(e), 1)).toEqual(['center', 'center', 'center'])

    openMenu('.table-col-menu[data-col-index="1"]', e)
    click(selector, e)
    expect(columnAligns(findTable(e), 1)).toEqual(['right', 'right', 'right'])

    openMenu('.table-col-menu[data-col-index="1"]', e)
    click(selector, e)
    expect(columnAligns(findTable(e), 1)).toEqual([null, null, null])
  })

  it('leaves other columns unaligned when only one column is cycled', () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-col-menu[data-col-index="1"]', e)
    click('.table-col-menu[data-col-index="1"] [data-action="align"]', e)
    expect(columnAligns(findTable(e), 0)).toEqual([null, null, null])
    expect(columnAligns(findTable(e), 2)).toEqual([null, null, null])
  })

  it('draws a highlight overlay while a column menu is open, and clears it on close', async () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-col-menu[data-col-index="1"]', e)
    await flushToggle()
    const overlay = e.view.dom.querySelector('.table-highlight')
    expect(overlay).not.toBeNull()
    expect(overlay?.getAttribute('data-owner')).toBe('col-1')

    const details = e.view.dom.querySelector('.table-col-menu[data-col-index="1"]')
    if (details instanceof HTMLDetailsElement) details.open = false
    await flushToggle()
    expect(e.view.dom.querySelector('.table-highlight')).toBeNull()
  })

  it('opening a second column menu closes the first', async () => {
    const e = mount(TABLE_HTML)
    openMenu('.table-col-menu[data-col-index="0"]', e)
    await flushToggle()
    openMenu('.table-col-menu[data-col-index="1"]', e)
    await flushToggle()
    const first = e.view.dom.querySelector('.table-col-menu[data-col-index="0"]')
    const second = e.view.dom.querySelector('.table-col-menu[data-col-index="1"]')
    expect(first instanceof HTMLDetailsElement && first.open).toBe(false)
    expect(second instanceof HTMLDetailsElement && second.open).toBe(true)
  })
})

function colMenuAction(col: number, action: string, e: Editor): void {
  openMenu(`.table-col-menu[data-col-index="${col}"]`, e)
  click(`.table-col-menu[data-col-index="${col}"] [data-action="${action}"]`, e)
}

function rowMenuAction(row: number, action: string, e: Editor): void {
  openMenu(`.table-row-menu[data-row-index="${row}"]`, e)
  click(`.table-row-menu[data-row-index="${row}"] [data-action="${action}"]`, e)
}

function bodyTexts(table: PMNode): string[][] {
  const rows: string[][] = []
  table.forEach((row, _offset, i) => {
    if (i > 0) rows.push(rowTexts(row))
  })
  return rows
}

describe('table row operations', () => {
  it('moves a row down and up from its menu', () => {
    const e = mount(TABLE_HTML)
    rowMenuAction(1, 'move-down', e)
    expect(bodyTexts(findTable(e))).toEqual([['4', '5', '6'], ['1', '2', '3']])
    rowMenuAction(2, 'move-up', e)
    expect(bodyTexts(findTable(e))).toEqual([['1', '2', '3'], ['4', '5', '6']])
  })

  it('offers no move or duplicate on the header row, and no move past its edge', () => {
    const e = mount(TABLE_HTML)
    expect(e.view.dom.querySelector('.table-row-menu[data-row-index="0"] [data-action="move-down"]')).toBeNull()
    expect(e.view.dom.querySelector('.table-row-menu[data-row-index="0"] [data-action="duplicate"]')).toBeNull()
    const up = e.view.dom.querySelector('.table-row-menu[data-row-index="1"] [data-action="move-up"]')
    expect((up as HTMLButtonElement).disabled).toBe(true)
  })

  it('duplicates a row directly after the original', () => {
    const e = mount(TABLE_HTML)
    rowMenuAction(1, 'duplicate', e)
    expect(bodyTexts(findTable(e))).toEqual([['1', '2', '3'], ['1', '2', '3'], ['4', '5', '6']])
  })

  it('restores the order with a single undo', () => {
    const e = mount(TABLE_HTML)
    rowMenuAction(1, 'move-down', e)
    e.commands.undo()
    expect(bodyTexts(findTable(e))).toEqual([['1', '2', '3'], ['4', '5', '6']])
  })
})

describe('table column operations', () => {
  it('moves a column right and keeps its alignment with it', () => {
    const e = mount(TABLE_HTML)
    colMenuAction(0, 'align', e)
    colMenuAction(0, 'move-right', e)
    const table = findTable(e)
    expect(rowTexts(table.firstChild!)).toEqual(['B', 'A', 'C'])
    expect(columnAligns(table, 1)).toEqual(['center', 'center', 'center'])
    expect(columnAligns(table, 0)).toEqual([null, null, null])
  })

  it('duplicates a column directly after the original, content and alignment included', () => {
    const e = mount(TABLE_HTML)
    colMenuAction(1, 'align', e)
    colMenuAction(1, 'duplicate', e)
    const table = findTable(e)
    expect(rowTexts(table.firstChild!)).toEqual(['A', 'B', 'B', 'C'])
    expect(rowTexts(table.child(1))).toEqual(['1', '2', '2', '3'])
    expect(columnAligns(table, 2)).toEqual(['center', 'center', 'center'])
  })

  it('disables moving the first column left and the last column right', () => {
    const e = mount(TABLE_HTML)
    const left = e.view.dom.querySelector('.table-col-menu[data-col-index="0"] [data-action="move-left"]')
    const right = e.view.dom.querySelector('.table-col-menu[data-col-index="2"] [data-action="move-right"]')
    expect((left as HTMLButtonElement).disabled).toBe(true)
    expect((right as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('table sort', () => {
  const sortable = (cells: string[]) =>
    '<table><tr><th>K</th><th>V</th></tr>' + cells.map((c, i) => `<tr><td>${c}</td><td>r${i}</td></tr>`).join('') + '</table>'
  const firstColumn = (e: Editor) => bodyTexts(findTable(e)).map((r) => r[0])

  it('sorts numerically when every non-empty cell is a number, header fixed', () => {
    const e = mount(sortable(['10', '9', '', '100']))
    colMenuAction(0, 'sort-asc', e)
    expect(firstColumn(e)).toEqual(['9', '10', '100', ''])
    expect(rowTexts(findTable(e).firstChild!)).toEqual(['K', 'V'])
  })

  it('sorts descending with empty cells still last', () => {
    const e = mount(sortable(['10', '', '9', '100']))
    colMenuAction(0, 'sort-desc', e)
    expect(firstColumn(e)).toEqual(['100', '10', '9', ''])
  })

  it('falls back to case-insensitive text for mixed content', () => {
    const e = mount(sortable(['banana', 'Apple', '10', 'cherry']))
    colMenuAction(0, 'sort-asc', e)
    expect(firstColumn(e)).toEqual(['10', 'Apple', 'banana', 'cherry'])
  })

  it('is stable for equal keys', () => {
    const e = mount(sortable(['b', 'a', 'b', 'a']))
    colMenuAction(0, 'sort-asc', e)
    expect(bodyTexts(findTable(e)).map((r) => r[1])).toEqual(['r1', 'r3', 'r0', 'r2'])
  })

  it('does not treat a math-only cell as empty', () => {
    const math = '<span data-type="inline-math" data-latex="a"></span>'
    const e = mount(sortable([math, 'z', '']))
    colMenuAction(0, 'sort-asc', e)
    expect(bodyTexts(findTable(e)).map((r) => r[1])).toEqual(['r0', 'r1', 'r2'])
  })
})

describe('pasting tables', () => {
  const EXCEL_HTML =
    '<html><body><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0><col width=64><tr height=20><td>Name</td><td>Score</td></tr>' +
    '<tr height=20><td>Ada</td><td align=right>9</td></tr></table><!--EndFragment--></body></html>'

  it('turns a spreadsheet HTML table into a table whose first row is the header', () => {
    const e = mount('<p></p>')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    const data: Record<string, string> = { 'text/html': EXCEL_HTML, 'text/plain': 'Name\tScore\nAda\t9' }
    Object.assign(paste, { clipboardData: { types: Object.keys(data), getData: (type: string) => data[type] ?? '' } })
    e.view.dom.dispatchEvent(paste)
    const table = findTable(e)
    expect(rowTexts(table.child(0))).toEqual(['Name', 'Score'])
    expect(table.child(0).child(0).type.name).toBe('tableHeader')
    expect(bodyTexts(table)).toEqual([['Ada', '9']])
  })
})
