import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'
import { handleEditorKeyDown, handleEditorTextInput } from './CodeBlockEditor'

let editor: Editor | null = null

// Mirrors NoteEditor's own editorProps. These handlers run ahead of every
// keymap plugin, which is the whole reason they can pre-empt ListKeymap — a
// mount without them tests an editor the app never actually builds.
function mount(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content,
    editorProps: {
      handleKeyDown: handleEditorKeyDown,
      handleTextInput: handleEditorTextInput,
    },
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

type KeyDownHandler = (view: Editor['view'], event: KeyboardEvent) => boolean | void

// Key handling lives partly in editorProps.handleKeyDown and partly in keymap
// plugins, and the two are ordered. someProp walks them in exactly the order
// the browser would, so this exercises the real precedence rather than one half.
function press(instance: Editor, key: string, shiftKey = false): void {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })
  instance.view.someProp('handleKeyDown', (f) =>
    (f as unknown as KeyDownHandler)(instance.view, event),
  )
}

// Puts the cursor at the end of the first text match, the way clicking there would.
function caretAfter(instance: Editor, needle: string): void {
  let position: number | null = null
  instance.state.doc.descendants((node, pos) => {
    if (position !== null) return false
    if (!node.isText) return true
    const index = (node.text ?? '').indexOf(needle)
    if (index !== -1) position = pos + index + needle.length
    return true
  })
  if (position === null) throw new Error(`no text node containing "${needle}"`)
  instance.commands.setTextSelection(position)
}

// Same, but before the match — for the Backspace-at-item-start cases.
function caretBefore(instance: Editor, needle: string): void {
  let position: number | null = null
  instance.state.doc.descendants((node, pos) => {
    if (position !== null) return false
    if (!node.isText) return true
    const index = (node.text ?? '').indexOf(needle)
    if (index !== -1) position = pos + index
    return true
  })
  if (position === null) throw new Error(`no text node containing "${needle}"`)
  instance.commands.setTextSelection(position)
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('list boundaries', () => {
  it('Enter on an empty top-level item leaves the list', () => {
    const e = mount('- one')
    caretAfter(e, 'one')
    press(e, 'Enter')
    press(e, 'Enter')
    expect(markdown(e)).toBe('- one')
  })

  it('Enter on an empty nested item outdents one level instead of leaving the list', () => {
    const e = mount('- one\n  - two')
    caretAfter(e, 'two')
    press(e, 'Enter')
    press(e, 'Enter')
    expect(markdown(e)).toBe('- one\n  - two\n- ')
  })

  it('Tab on the first item of a list does not insert stray whitespace', () => {
    const e = mount('- one')
    caretAfter(e, 'one')
    press(e, 'Tab')
    expect(markdown(e)).toBe('- one')
  })

  it('Tab on a later item indents it under the previous one', () => {
    const e = mount('- one\n- two')
    caretAfter(e, 'two')
    press(e, 'Tab')
    expect(markdown(e)).toBe('- one\n  - two')
  })

  it('Shift-Tab on a top-level item lifts it out of the list', () => {
    const e = mount('- one')
    caretAfter(e, 'one')
    press(e, 'Tab', true)
    expect(markdown(e)).toBe('one')
  })

  it('Backspace at the start of the first item lifts it out of the list', () => {
    const e = mount('- one')
    caretBefore(e, 'one')
    press(e, 'Backspace')
    expect(markdown(e)).toBe('one')
  })

  it('Backspace at the start of a later item joins it to the previous one', () => {
    const e = mount('- one\n- two')
    caretBefore(e, 'two')
    press(e, 'Backspace')
    expect(markdown(e)).toBe('- onetwo')
  })

  // Asserted on the indent rather than the exact string: the serializer emits a
  // blank line before a nested *task* list (but not a nested bullet list), which
  // is loose-vs-tight cosmetics and round-trips to the same structure.
  it('Backspace at the start of a later task item joins it to the previous one', () => {
    const e = mount('- [ ] one\n- [ ] two')
    caretBefore(e, 'two')
    press(e, 'Backspace')
    expect(markdown(e)).toBe('- [ ] onetwo')
  })

  it("Backspace in an item's second paragraph merges inside that item", () => {
    const e = mount('- one\n\n  second\n\n- three')
    caretBefore(e, 'second')
    press(e, 'Backspace')
    expect(markdown(e)).toContain('onesecond')
  })

  it('Tab inside a task item indents it, like a bullet item', () => {
    const e = mount('- [ ] one\n- [ ] two')
    caretAfter(e, 'two')
    press(e, 'Tab')
    expect(markdown(e)).toContain('  - [ ] two')
  })

  it('Enter on an empty task item leaves the list', () => {
    const e = mount('- [ ] one')
    caretAfter(e, 'one')
    press(e, 'Enter')
    press(e, 'Enter')
    expect(markdown(e)).toBe('- [ ] one')
  })
})
