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

describe('SrCardHighlight (P9-3)', () => {
  it('decorates a Q::A paragraph', () => {
    const e = mount('What is Big-O of binary search? :: O(log n)')
    const el = e.view.dom.querySelector('.sr-card-qa')
    expect(el).toBeTruthy()
    expect(el?.textContent).toContain('::')
  })

  it('decorates a cloze paragraph', () => {
    const e = mount('A tree keeps {{all left descendants smaller}} than the node.')
    const el = e.view.dom.querySelector('.sr-cloze')
    expect(el).toBeTruthy()
  })

  it('does not decorate plain prose', () => {
    const e = mount('Just an ordinary sentence.')
    expect(e.view.dom.querySelector('.sr-card-qa')).toBeFalsy()
    expect(e.view.dom.querySelector('.sr-cloze')).toBeFalsy()
  })

  it('never changes getMarkdown output — decoration is view-layer only', () => {
    const md = 'What is Big-O of binary search? :: O(log n)'
    const e = mount(md)
    expect(getMarkdown(e)).toBe(md)
  })
})
