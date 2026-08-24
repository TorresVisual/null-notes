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

describe('table hover-grip controls', () => {
  it('renders one column grip and one row grip per column/row', () => {
    const e = mount(TABLE_HTML)
    expect(e.view.dom.querySelectorAll('.table-col-grip').length).toBe(3)
    expect(e.view.dom.querySelectorAll('.table-row-grip').length).toBe(3)
  })

  it('renders no controls when the document has no table', () => {
    const e = mount('<p>no table here</p>')
    expect(e.view.dom.querySelectorAll('.table-controls').length).toBe(0)
  })

  it('deletes the clicked column, leaving the others in order', () => {
    const e = mount(TABLE_HTML)
    click('.table-col-grip[data-col-index="1"] .table-grip-delete', e)
    const table = findTable(e)
    expect(table.firstChild!.childCount).toBe(2)
    expect(rowTexts(table.firstChild!)).toEqual(['A', 'C'])
  })

  it('inserts a column before the clicked grip', () => {
    const e = mount(TABLE_HTML)
    click('.table-col-grip[data-col-index="1"] .table-grip-insert', e)
    const table = findTable(e)
    expect(table.firstChild!.childCount).toBe(4)
    expect(rowTexts(table.firstChild!)).toEqual(['A', '', 'B', 'C'])
  })

  it('appends a column at the end via the trailing control', () => {
    const e = mount(TABLE_HTML)
    click('.table-col-append', e)
    const table = findTable(e)
    expect(table.firstChild!.childCount).toBe(4)
    expect(rowTexts(table.firstChild!)).toEqual(['A', 'B', 'C', ''])
  })

  it('deletes the clicked row, leaving the others in order', () => {
    const e = mount(TABLE_HTML)
    click('.table-row-grip[data-row-index="1"] .table-grip-delete', e)
    const table = findTable(e)
    expect(table.childCount).toBe(2)
    expect(rowTexts(table.child(1))).toEqual(['4', '5', '6'])
  })

  it('inserts a row before the clicked grip', () => {
    const e = mount(TABLE_HTML)
    click('.table-row-grip[data-row-index="1"] .table-grip-insert', e)
    const table = findTable(e)
    expect(table.childCount).toBe(4)
    expect(rowTexts(table.child(1))).toEqual(['', '', ''])
    expect(rowTexts(table.child(2))).toEqual(['1', '2', '3'])
  })

  it('appends a row at the end via the trailing control', () => {
    const e = mount(TABLE_HTML)
    click('.table-row-append', e)
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

  it('rebuilds grips to match the new column count after a delete', () => {
    const e = mount(TABLE_HTML)
    click('.table-col-grip[data-col-index="0"] .table-grip-delete', e)
    expect(e.view.dom.querySelectorAll('.table-col-grip').length).toBe(2)
  })

  it("cycles a column's alignment through center, right, then back to default, applied to every cell in the column", () => {
    const e = mount(TABLE_HTML)
    const selector = '.table-col-grip[data-col-index="1"] .table-grip-align'

    click(selector, e)
    expect(columnAligns(findTable(e), 1)).toEqual(['center', 'center', 'center'])

    click(selector, e)
    expect(columnAligns(findTable(e), 1)).toEqual(['right', 'right', 'right'])

    click(selector, e)
    expect(columnAligns(findTable(e), 1)).toEqual([null, null, null])
  })

  it('leaves other columns unaligned when only one column is cycled', () => {
    const e = mount(TABLE_HTML)
    click('.table-col-grip[data-col-index="1"] .table-grip-align', e)
    expect(columnAligns(findTable(e), 0)).toEqual([null, null, null])
    expect(columnAligns(findTable(e), 2)).toEqual([null, null, null])
  })
})
