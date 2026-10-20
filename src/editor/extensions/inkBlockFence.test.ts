import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function load(fenceJson: string) {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content: '```ink\n' + fenceJson + '\n```',
  })
  const attrs: Array<Record<string, unknown>> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'inkBlock') attrs.push(node.attrs)
    return true
  })
  const markdown = (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
  return { attrs: attrs[0], markdown }
}

describe('the ink fence', () => {
  it('parses a fence without the flag as not inline, and does not write one back', () => {
    const { attrs, markdown } = load('{"src":"/ws/N.ink/a.svg","width":700,"height":400}')

    expect(attrs?.inline).toBe(false)
    expect(markdown).toContain('{"src":"/ws/N.ink/a.svg","width":700,"height":400}')
    expect(markdown).not.toContain('inline')
  })

  it('keeps inline: true through parse and serialize', () => {
    const { attrs, markdown } = load('{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":true}')

    expect(attrs?.inline).toBe(true)
    expect(markdown).toContain('{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":true}')
  })

  it('treats inline: false in a hand-edited fence as not inline and drops it', () => {
    const { attrs, markdown } = load('{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":false}')

    expect(attrs?.inline).toBe(false)
    expect(markdown).not.toContain('inline')
  })
})
