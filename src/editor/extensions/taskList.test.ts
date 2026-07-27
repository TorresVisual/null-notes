import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content,
  })
  return editor
}

interface MarkdownStorage {
  getMarkdown: () => string
}

function markdown(instance: Editor): string {
  const storage = instance.storage as unknown as { markdown: MarkdownStorage }
  return storage.markdown.getMarkdown()
}

type TextInputHandler = (
  view: Editor['view'],
  from: number,
  to: number,
  text: string,
) => boolean | void

// insertContent bypasses input rules, so typing has to go through the same
// handleTextInput path the browser uses or "[ ] " never becomes a checkbox.
function type(instance: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = instance.state.selection
    const handled = instance.view.someProp(
      'handleTextInput',
      (f) => (f as unknown as TextInputHandler)(instance.view, from, to, char),
    )
    if (!handled) instance.view.dispatch(instance.state.tr.insertText(char, from, to))
  }
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('task lists', () => {
  it('round-trips an unchecked item', () => {
    const e = mount('- [ ] buy milk')
    expect(markdown(e)).toBe('- [ ] buy milk')
  })

  it('round-trips a checked item', () => {
    const e = mount('- [x] buy milk')
    expect(markdown(e)).toBe('- [x] buy milk')
  })

  it('creates a real task item from the toggleTaskList command', () => {
    const e = mount('buy milk')
    e.commands.toggleTaskList()
    expect(markdown(e)).toBe('- [ ] buy milk')
  })

  it('turns a typed "[ ] " into a checkbox', () => {
    const e = mount('')
    type(e, '[ ] buy milk')
    expect(markdown(e)).toBe('- [ ] buy milk')
  })

  it('turns a typed "- [ ] " into a checkbox, not literal brackets', () => {
    const e = mount('')
    type(e, '- [ ] buy milk')
    expect(markdown(e)).toBe('- [ ] buy milk')
  })

  // The real scenario: an existing note, cursor on a fresh line at the end.
  it('turns a typed checklist into a checkbox inside an existing note', () => {
    const e = mount('# test')
    e.commands.setTextSelection(e.state.doc.content.size)
    e.commands.enter()
    type(e, '- [ ] buy milk')
    expect(markdown(e)).toBe('# test\n\n- [ ] buy milk')
  })

  it('recovers legacy escaped brackets written by older builds', () => {
    const e = mount('- \\[ \\] buy milk')
    expect(markdown(e)).toBe('- [ ] buy milk')
  })
})
