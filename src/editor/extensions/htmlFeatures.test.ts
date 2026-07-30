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

describe('HTML typography marks', () => {
  it('parses and serializes <u>', () => {
    const e = mount('<u>hello</u>')
    const u = e.view.dom.querySelector('u')
    expect(u).toBeTruthy()
    expect(getMarkdown(e)).toContain('<u>hello</u>')
  })

  it('parses and serializes <sub>', () => {
    const e = mount('H<sub>2</sub>O')
    const sub = e.view.dom.querySelector('sub')
    expect(sub).toBeTruthy()
    expect(getMarkdown(e)).toContain('<sub>2</sub>')
  })

  it('parses and serializes <sup>', () => {
    const e = mount('x<sup>2</sup>')
    const sup = e.view.dom.querySelector('sup')
    expect(sup).toBeTruthy()
    expect(getMarkdown(e)).toContain('<sup>2</sup>')
  })

  it('parses and serializes <mark>', () => {
    const e = mount('<mark>highlighted</mark>')
    const mark = e.view.dom.querySelector('mark')
    expect(mark).toBeTruthy()
    expect(getMarkdown(e)).toContain('<mark>highlighted</mark>')
  })

  it('parses and serializes <kbd>', () => {
    const e = mount('<kbd>Ctrl+C</kbd>')
    const kbd = e.view.dom.querySelector('kbd')
    expect(kbd).toBeTruthy()
    expect(getMarkdown(e)).toContain('<kbd>Ctrl+C</kbd>')
  })
})

describe('SpanStyle mark', () => {
  it('preserves color style', () => {
    const e = mount('<span style="color: red">text</span>')
    const span = e.view.dom.querySelector('span[style]')
    expect(span).toBeTruthy()
    const md = getMarkdown(e)
    expect(md).toContain('color: red')
  })

  it('preserves background-color style', () => {
    const e = mount('<span style="background-color: yellow">text</span>')
    const md = getMarkdown(e)
    expect(md).toContain('background-color: yellow')
  })
})

describe('Details node', () => {
  it('parses <details><summary> and serializes back to HTML', () => {
    const html = '<details><summary>Click me</summary><p>Body content</p></details>'
    const e = mount(html)
    const md = getMarkdown(e)
    expect(md).toContain('<details>')
    expect(md).toContain('<summary>Click me</summary>')
    expect(md).toContain('Body content')
  })
})

describe('DivBlock node', () => {
  it('parses a generic <div> and preserves content', () => {
    const e = mount('<div><p>inside div</p></div>')
    const md = getMarkdown(e)
    expect(md).toContain('<div>')
    expect(md).toContain('inside div')
    expect(md).toContain('</div>')
  })

  it('preserves align attribute', () => {
    const e = mount('<div align="center"><p>centered</p></div>')
    const md = getMarkdown(e)
    expect(md).toContain('align="center"')
  })
})

describe('HTMLBlock node', () => {
  it('preserves SVG blocks verbatim', () => {
    const svg = '<svg width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>'
    const e = mount(svg)
    const md = getMarkdown(e)
    expect(md).toContain('<svg')
    expect(md).toContain('<circle')
  })

  it('preserves iframe blocks verbatim', () => {
    const iframe = '<iframe src="https://example.com" width="600" height="400"></iframe>'
    const e = mount(iframe)
    const md = getMarkdown(e)
    expect(md).toContain('<iframe')
    expect(md).toContain('example.com')
  })
})

describe('NoteImage width/height', () => {
  it('round-trips dimensions as HTML img tag', () => {
    const e = mount('<img src="image.png" width="400" height="200">')
    const md = getMarkdown(e)
    expect(md).toContain('width="400"')
    expect(md).toContain('height="200"')
  })
})
