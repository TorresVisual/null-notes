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

describe('paste HTML span[style] unwrapping', () => {
  it('strips an IDE\'s baseline-foreground-color span from pasted text', () => {
    const e = mount()
    const html = '<span style="color: rgb(204, 204, 204);">- [ ] better loading screen</span>'
    expect(transformPastedHTML(e, html)).toBe('- [ ] better loading screen')
  })

  it('unwraps nested styled spans too', () => {
    const e = mount()
    const html = '<span style="color: red;"><span style="font-size: 12px;">text</span></span>'
    expect(transformPastedHTML(e, html)).toBe('text')
  })

  it('leaves a plain span with no style attribute intact', () => {
    const e = mount()
    const html = '<span>text</span>'
    expect(transformPastedHTML(e, html)).toBe(html)
  })
})
