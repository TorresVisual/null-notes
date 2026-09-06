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
