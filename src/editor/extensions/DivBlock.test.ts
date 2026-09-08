import { describe, it, expect, afterEach } from 'vitest'

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount() {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content: '<p></p>' })
  return editor
}

function transformPastedHTML(e: InstanceType<typeof Editor>, html: string): string {
  let result = html
  e.view.someProp('transformPastedHTML', (f) => {
    result = f(result, e.view)
  })
  return result
}

interface MarkdownStorage {
  getMarkdown: () => string
}

function getMarkdown(e: InstanceType<typeof Editor>): string {
  return ((e.storage as unknown as Record<string, unknown>)['markdown'] as MarkdownStorage).getMarkdown()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('paste HTML div unwrapping', () => {
  it('strips layout divs from pasted website markup', () => {
    const e = mount()
    const html = '<div class="container"><div id="post-body"><p>Hello</p></div></div>'
    expect(transformPastedHTML(e, html)).toBe('<p>Hello</p>')
  })

  it('leaves divs claimed by other nodes (data-type) intact', () => {
    const e = mount()
    const html = '<div data-type="callout"><p>Note</p></div>'
    expect(transformPastedHTML(e, html)).toBe(html)
  })
})

describe('DivBlock markdown serialize', () => {
  // A note loaded from a `<div style="...">` an attacker (or a stray paste)
  // wrote by hand must not let its attribute value break out of the quotes
  // it's serialized back into (M-5).
  it('escapes a quote in a style attribute so it cannot close the attribute early', () => {
    const e = mount()
    e.commands.setContent('<div style=\'x"onmouseover="alert(1)\'><p>hi</p></div>')
    const md = getMarkdown(e)
    expect(md).toContain('&quot;')
    expect(md).not.toContain('x"onmouseover="alert(1)"')
  })
})
