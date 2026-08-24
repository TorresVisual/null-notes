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
