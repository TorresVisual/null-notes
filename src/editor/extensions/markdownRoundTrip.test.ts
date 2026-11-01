import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function roundTrip(markdown: string): string {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content: markdown })
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('code fences (#167)', () => {
  it('keeps a longer fence around a block that contains a ``` fence', () => {
    const src = '````md\n```js\ninner\n```\n````'
    expect(roundTrip(src)).toBe(src)
  })

  it('still uses a plain 3-backtick fence when the code has no backtick run', () => {
    const src = '```js\nconst a = `x`\n```'
    expect(roundTrip(src)).toBe(src)
  })
})

