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

function hasNestedOrderedList(editorInstance: Editor): boolean {
  let nested = false
  editorInstance.state.doc.descendants((node) => {
    if (node.type.name !== 'orderedList') return
    node.descendants((inner) => {
      if (inner.type.name === 'orderedList') nested = true
    })
  })
  return nested
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('inserting a divider inside a nested list item', () => {
  // Mirrors the real PDF-import bug: a list whose first item's own number
  // ("Aufgabe 12") is kept as `start`, so a divider split mid-list must not
  // just copy that `start` onto the half that comes after it.
  it('a list that does not start at 1 resets to 1 after the divider', () => {
    const e = mount('12. Übungsblatt\n\n13. Lösen Sie...')
    caretAfter(e, 'Übungsblatt')
    e.commands.setHorizontalRule()
    expect(markdown(e)).toBe('12. Übungsblatt\n\n---\n\n1. Lösen Sie...')
  })

  // Two markdown lists separated by a blank line, indented too little (2
  // spaces, CommonMark needs 4+) to actually nest — markdown-it merges them
  // into one flat list instead. Regression coverage for the same start-reset
  // fix via a different route into a flat list.
  it('flattened markdown lists still reset numbering after the divider', () => {
    const e = mount('12. Übungsblatt\n\n  1. Lösen Sie...')
    caretAfter(e, 'Übungsblatt')
    e.commands.setHorizontalRule()
    expect(hasNestedOrderedList(e)).toBe(false)
    expect(markdown(e)).toBe('12. Übungsblatt\n\n---\n\n1. Lösen Sie...')
  })

  // A genuinely (Tab-)nested list is a deeper structure than the divider
  // command's split+lift loop can always fully unwind — TipTap's own
  // splitListItem declines to split an already-empty, already-flat block a
  // second time. The loop climbs as far as it can and stops there rather
  // than failing outright, which would silently drop the divider.
  it('climbs at least one level out of a genuinely nested list without corrupting it', () => {
    const e = mount('1. Übungsblatt')
    caretAfter(e, 'Übungsblatt')
    e.commands.enter()
    e.commands.sinkListItem('listItem')
    e.commands.insertContent('Lösen Sie...')
    expect(hasNestedOrderedList(e)).toBe(true) // sanity: this really did nest

    caretAfter(e, 'Lösen Sie...')
    const ok = e.commands.setHorizontalRule()

    expect(ok).toBe(true)
    expect(markdown(e)).toContain('---')
    expect(markdown(e)).toContain('Übungsblatt')
    expect(markdown(e)).toContain('Lösen Sie...')
  })
})
