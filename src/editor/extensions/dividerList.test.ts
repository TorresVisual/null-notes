import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

interface MarkdownStorage {
  getMarkdown: () => string
}

function markdown(instance: Editor): string {
  const storage = instance.storage as unknown as { markdown: MarkdownStorage }
  return storage.markdown.getMarkdown()
}

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

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('inserting a divider inside a list', () => {
  it('splits the list instead of nesting the hr inside the last item', () => {
    const e = mount('1. one\n2. two')
    caretAfter(e, 'two')
    e.commands.setHorizontalRule()

    const orderedLists = e.state.doc.content.content.filter((n) => n.type.name === 'orderedList')
    expect(orderedLists).toHaveLength(1)
    expect(orderedLists[0]?.lastChild?.childCount).toBe(1) // just the "two" paragraph, no nested hr
  })

  it('a list typed after the divider restarts numbering at 1', () => {
    const e = mount('1. one\n2. two')
    caretAfter(e, 'two')
    e.commands.setHorizontalRule()
    e.commands.setTextSelection(e.state.doc.content.size)
    e.commands.toggleOrderedList()
    e.commands.insertContent('three')

    expect(markdown(e)).toBe('1. one\n2. two\n\n---\n\n1. three')
  })

  it('mid-list divider splits into two lists, both starting at 1', () => {
    const e = mount('1. one\n2. two\n3. three')
    caretAfter(e, 'two')
    e.commands.setHorizontalRule()

    expect(markdown(e)).toBe('1. one\n2. two\n\n---\n\n1. three')
  })

  it('divider outside any list still inserts in place', () => {
    const e = mount('before\n\nafter')
    caretAfter(e, 'before')
    e.commands.setHorizontalRule()

    expect(markdown(e)).toBe('before\n\n---\n\nafter')
  })
})
