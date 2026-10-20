import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from '../extensions'
import { insertInk } from './insertInk'

vi.mock('../../lib/ink', () => ({
  inkApi: { ensureDir: () => Promise.resolve('/ws/N.ink'), write: () => Promise.resolve() },
}))

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('insertInk', () => {
  it('inserts a block and asks that block to open its editor', async () => {
    editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content: '<p></p>' })
    const seen: string[] = []
    const listener = (e: Event) => seen.push((e as CustomEvent<{ src: string }>).detail.src)
    window.addEventListener('ink:auto-open', listener)

    await insertInk(editor, '/ws/N.md')
    window.removeEventListener('ink:auto-open', listener)

    const srcs: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'inkBlock') srcs.push(node.attrs.src as string)
      return true
    })
    expect(srcs).toHaveLength(1)
    expect(seen).toEqual(srcs)
  })
})
