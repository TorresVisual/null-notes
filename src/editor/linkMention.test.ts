import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './extensions'
import { linkMention } from './linkMention'

let editor: Editor

function mount(content: string) {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
}

afterEach(() => editor.destroy())

describe('linkMention', () => {
  it('links the first prose mention and keeps the typed casing as the label', () => {
    mount('<p>Read about <code>graphs</code> then GRAPHS and graphs.</p>')
    expect(linkMention(editor, 'Graphs')).toBe(true)
    const links: { title: string; label: string }[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'wikiLink') links.push(node.attrs as { title: string; label: string })
    })
    expect(links).toEqual([expect.objectContaining({ title: 'Graphs', label: 'GRAPHS' })])
    expect(editor.getText()).toContain('graphs.')
  })

  it('leaves mentions inside code blocks alone', () => {
    mount('<pre><code>Graphs</code></pre><p>nothing</p>')
    expect(linkMention(editor, 'Graphs')).toBe(false)
  })
})
