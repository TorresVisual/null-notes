import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

interface MarkdownStorage {
  getMarkdown: () => string
}

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

function getMarkdown(e: Editor): string {
  return ((e.storage as unknown as Record<string, unknown>)['markdown'] as MarkdownStorage).getMarkdown()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('table column alignment', () => {
  it('parses GFM alignment delimiters into per-column align attributes', () => {
    const md = '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |'
    const e = mount(md)
    const aligns: (string | null)[] = []
    e.state.doc.descendants((node) => {
      if (node.type.name === 'tableHeader') aligns.push((node.attrs['align'] as string | null) ?? null)
      return true
    })
    expect(aligns).toEqual(['left', 'center', 'right'])
  })

  it('serializes a centered column back to a :---: delimiter, others plain', () => {
    const html =
      '<table><tr><th style="text-align:center">A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    const e = mount(html)
    expect(getMarkdown(e)).toContain('| :---: | --- |')
  })

  it('round-trips a right-aligned column through parse then serialize', () => {
    const md = '| Case | Runtime |\n| --- | ---: |\n| Best | O(1) |'
    const e = mount(md)
    const out = getMarkdown(e)
    expect(out).toContain('| --- | ---: |')
    expect(out).toContain('O(1)')
  })

  it('serializes an unaligned table exactly as before (no stray delimiter markers)', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    const e = mount(html)
    expect(getMarkdown(e)).toContain('| --- | --- |')
  })
})
