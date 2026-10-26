import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('copying from the WYSIWYG view', () => {
  it('puts rendered text, not Markdown syntax, on the plain-text clipboard', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: coreExtensions,
      content: '# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two',
    })
    editor.commands.selectAll()
    const { text } = editor.view.serializeForClipboard(editor.state.selection.content())
    expect(text).toContain('Title')
    expect(text).toContain('Some bold and italic text.')
    expect(text).not.toMatch(/[#*]/)
  })
})
