import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

// Analysis_2_Blatt12.pdf's exercise 6: a digit item, its equation, then
// lettered sub-parts that layout.rs force-nests one level deeper. The
// equation must be indented to that same depth (layout.rs's
// intervening_block_indent) for the whole thing to survive as one nested
// structure instead of the equation closing the list and the sub-parts
// landing in a codeBlock.
describe('a display equation sitting between a list item and its deeper sub-parts', () => {
  it('nests the equation and the sub-list inside the parent list item', () => {
    const md = [
      '6. Gegeben ist das nichtlineare System:',
      '',
      '    $',
      "    y'_1(t) = y_1(1 - y_1 - y_2), y'_2(t) = y_2(2 - y_1 - 2y_2).",
      '    $',
      '',
      '    1. Bestimmen Sie alle (drei) Fixpunkte (Ruhelagen) dieses Systems.',
      '',
      '    2. Linearisieren Sie das System in den Fixpunkten und bestimmen Sie jeweils.',
    ].join('\n')
    const e = mount(md)

    const doc = e.state.doc.toJSON() as { content: Array<Record<string, unknown>> }
    expect(doc.content).toHaveLength(1)
    const outerList = doc.content[0]!
    expect(outerList['type']).toBe('orderedList')
    expect((outerList['attrs'] as Record<string, unknown>)['start']).toBe(6)

    const listItem = (outerList['content'] as Array<Record<string, unknown>>)[0]!
    const itemContent = listItem['content'] as Array<Record<string, unknown>>
    const childTypes = itemContent.map((node) => node['type'])
    expect(childTypes).toEqual(['paragraph', 'blockMath', 'orderedList'])

    const innerList = itemContent[2] as Record<string, unknown>
    expect((innerList['attrs'] as Record<string, unknown>)['start']).toBe(1)
    expect((innerList['content'] as unknown[]).length).toBe(2)
  })

  it('does not nest when the equation sits between two same-depth exercises', () => {
    const md = [
      '3. Ein gedaempftes System:',
      '',
      '$',
      "y''(t) + 2y'(t) = 0.",
      '$',
      '',
      'Bestimmen Sie die Ausschlagung.',
      '',
      '4. Naechste Aufgabe',
    ].join('\n')
    const e = mount(md)

    const doc = e.state.doc.toJSON() as { content: Array<Record<string, unknown>> }
    const topLevelTypes = doc.content.map((node) => node['type'])
    expect(topLevelTypes).toEqual(['orderedList', 'blockMath', 'paragraph', 'orderedList'])

    const firstList = doc.content[0] as Record<string, unknown>
    const secondList = doc.content[3] as Record<string, unknown>
    expect((firstList['attrs'] as Record<string, unknown>)['start']).toBe(3)
    expect((secondList['attrs'] as Record<string, unknown>)['start']).toBe(4)
  })
})
