import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function mount(content: string, spellcheck: boolean): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content,
    editorProps: { attributes: { spellcheck: String(spellcheck) } },
  })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('spellcheck scope', () => {
  it('marks the editor itself according to the setting', () => {
    const on = mount('hello', true)
    expect(on.view.dom.getAttribute('spellcheck')).toBe('true')
    on.destroy()

    const off = mount('hello', false)
    expect(off.view.dom.getAttribute('spellcheck')).toBe('false')
  })

  // spellcheck is inherited, so a false on these carves them out of an
  // editor-wide "true" — the whole point of the exclusion.
  it('excludes a fenced code block even when the editor is checked', () => {
    const e = mount('```rust\nfn recieve() {}\n```', true)
    const pre = e.view.dom.querySelector('pre')
    expect(pre?.getAttribute('spellcheck')).toBe('false')
  })

  it('excludes inline code even when the editor is checked', () => {
    const e = mount('call `recieve_teh_thing()` first', true)
    const code = e.view.dom.querySelector('code')
    expect(code?.getAttribute('spellcheck')).toBe('false')
  })

  it('leaves ordinary prose inheriting the editor setting', () => {
    const e = mount('this is ordinary prose', true)
    const paragraph = e.view.dom.querySelector('p')
    expect(paragraph?.hasAttribute('spellcheck')).toBe(false)
  })
})
