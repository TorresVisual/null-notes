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

  it('round-trips a 5-field schedule comment with a trailing grade unchanged', () => {
    const md = 'What is Big-O of binary search? :: O(log n)\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->'
    const e = mount(md)
    expect(getMarkdown(e)).toContain(
      '<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->',
    )
  })

  // (I3) prosemirror-markdown inserts a blank line between the option
  // taskList and the differently-typed srState comment that follows it —
  // the same boundary rule `mc_options_start` already documents for the
  // question→options side. Confirmed here rather than assumed: the comment
  // survives intact (no loss, no duplication), just shifted one line down.
  // `sr_comment_idx` (src-tauri/src/commands/notes.rs) is what makes the
  // Rust side tolerate that shift on both read and re-grade.
  it('round-trips a schedule comment following an MC option list, tolerating the blank line prosemirror-markdown inserts', () => {
    const md = 'Q ::\n- [ ] a\n- [x] b\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->'
    const e = mount(md)
    const out = getMarkdown(e)
    expect(out).toContain('- [x] b\n\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good -->')
    expect(out.match(/<!-- sr /g)?.length).toBe(1)
  })

  it('round-trips a 6-field schedule comment with a trailing streak unchanged', () => {
    const md = 'What is Big-O of binary search? :: O(log n)\n<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good streak=1 -->'
    const e = mount(md)
    expect(getMarkdown(e)).toContain(
      '<!-- sr due=2026-08-21 ease=2.50 interval=1 reps=1 grade=good streak=1 -->',
    )
  })

  it('leaves a note with no schedule comment completely unaffected', () => {
    const md = 'Just an ordinary note with no cards.'
    const e = mount(md)
    expect(getMarkdown(e)).toBe(md)
  })
})
