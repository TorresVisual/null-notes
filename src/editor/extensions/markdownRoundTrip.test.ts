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

describe('HTML comments (#168)', () => {
  it('keeps a standalone comment', () => {
    expect(roundTrip('before\n\n<!-- keep me -->\n\nafter')).toContain('<!-- keep me -->')
  })

  it('keeps a multi-line comment verbatim', () => {
    const src = 'before\n\n<!--\nline one\nline two\n-->\n\nafter'
    expect(roundTrip(src)).toContain('<!--\nline one\nline two\n-->')
  })

  it('leaves a flashcard schedule comment to SrState, once', () => {
    const out = roundTrip('Q :: A\n\n<!-- sr due=2026-11-02 ease=2.5 interval=1 reps=1 -->')
    expect(out.match(/<!-- sr /g)).toHaveLength(1)
  })
})

