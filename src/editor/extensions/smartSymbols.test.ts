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
// handleTextInput path the browser uses or "!=" never becomes "≠".
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

describe('smart symbols', () => {
  it('converts a typed "!=" to ≠', () => {
    const e = mount('')
    type(e, 'a != b')
    expect(markdown(e)).toBe('a ≠ b')
  })

  it('converts a typed "<=" to ≤', () => {
    const e = mount('')
    type(e, 'a <= b')
    expect(markdown(e)).toBe('a ≤ b')
  })

  it('converts a typed ">=" to ≥', () => {
    const e = mount('')
    type(e, 'a >= b')
    expect(markdown(e)).toBe('a ≥ b')
  })

  it('converts a typed "->" to →', () => {
    const e = mount('')
    type(e, 'a -> b')
    expect(markdown(e)).toBe('a → b')
  })

  it('converts a typed "<-" to ←', () => {
    const e = mount('')
    type(e, 'a <- b')
    expect(markdown(e)).toBe('a ← b')
  })

  it('converts a typed "<->" to ↔', () => {
    const e = mount('')
    type(e, 'a <-> b')
    expect(markdown(e)).toBe('a ↔ b')
  })

  it('leaves "!=" untouched inside a code block', () => {
    const e = mount('')
    e.commands.setCodeBlock()
    type(e, 'a != b')
    expect(markdown(e)).toBe('```\na != b\n```')
  })

  it('leaves "!=" untouched inside inline code', () => {
    const e = mount('')
    e.commands.toggleCode()
    type(e, 'a != b')
    expect(markdown(e)).toBe('`a != b`')
  })
})
