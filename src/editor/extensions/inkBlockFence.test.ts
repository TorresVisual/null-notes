import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { extensionsFor } from './index'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function load(content: string, notePath = '') {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: extensionsFor(notePath),
    content,
  })
  const attrs: Array<Record<string, unknown>> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'inkBlock') attrs.push(node.attrs)
    return true
  })
  const markdown = (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
  return { attrs: attrs[0], markdown }
}

const fence = (json: string) => '```ink\n' + json + '\n```'

describe('the ink fence (legacy)', () => {
  it('parses a fence without the flag as not inline, and writes it back as an image', () => {
    const { attrs, markdown } = load(fence('{"src":"/ws/N.ink/a.svg","width":700,"height":400}'))

    expect(attrs?.inline).toBe(false)
    expect(markdown).toBe('![Drawing](N.ink/a.svg#ink=700x400)')
  })

  it('keeps inline: true through parse and serialize', () => {
    const { attrs, markdown } = load(fence('{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":true}'))

    expect(attrs?.inline).toBe(true)
    expect(markdown).toBe('![Drawing](N.ink/a.svg#ink=700x400,inline)')
  })

  it('treats inline: false in a hand-edited fence as not inline and drops it', () => {
    const { attrs, markdown } = load(fence('{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":false}'))

    expect(attrs?.inline).toBe(false)
    expect(markdown).not.toContain('inline')
  })
})

describe('the ink image', () => {
  it('opens as an ink block whose src is beside the note', () => {
    const { attrs } = load('![Drawing](My%20Note.ink/a.svg#ink=900x1200,inline)', '/ws/My Note.md')

    expect(attrs).toMatchObject({ src: '/ws/My Note.ink/a.svg', width: 900, height: 1200, inline: true })
  })

  it('uses the note separator on Windows paths', () => {
    const { attrs } = load('![Drawing](N.ink/a.svg#ink=700x400)', 'C:\\ws\\N.md')

    expect(attrs?.src).toBe('C:\\ws\\N.ink\\a.svg')
  })

  it('round-trips to the same relative, URL-encoded line', () => {
    const line = '![Drawing](My%20Note.ink/a.svg#ink=700x400)'
    const { markdown } = load(line, '/ws/My Note.md')

    expect(markdown).toBe(line)
  })

  it('leaves an ordinary image alone', () => {
    const { attrs } = load('![x](N.assets/a.png)', '/ws/N.md')

    expect(attrs).toBeUndefined()
  })
})
