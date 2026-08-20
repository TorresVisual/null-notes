import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

interface MarkdownStorage {
  getMarkdown: () => string
}

function mount(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content,
  })
  return editor
}

function getMarkdown(e: Editor): string {
  return ((e.storage as unknown as Record<string, unknown>)['markdown'] as MarkdownStorage).getMarkdown()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('SrState node (P9-3)', () => {
  it('round-trips a schedule comment through mount and getMarkdown unchanged', () => {
    const md = 'What is Big-O of binary search? :: O(log n)\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->'
    const e = mount(md)
    expect(getMarkdown(e)).toContain('<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->')
  })

  it('renders the sr-state node invisibly in the editor DOM', () => {
    const md = 'Q :: A\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 -->'
    const e = mount(md)
    const el = e.view.dom.querySelector('[data-type="sr-state"]')
    expect(el).toBeTruthy()
    expect(getComputedStyle(el as Element).display).toBe('none')
  })

  it('leaves a note with no schedule comment completely unaffected', () => {
    const md = 'Just an ordinary note with no cards.'
    const e = mount(md)
    expect(getMarkdown(e)).toBe(md)
  })
})
