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

  it('never persists open/collapsed state to markdown (P6-1: presentation-only)', () => {
    const html = '<details open><summary>x</summary><p>body</p></details>'
    const e = mount(html)
    const md = getMarkdown(e)
    expect(md).toContain('<details>')
    expect(md).not.toContain('<details open>')
  })
})

function calloutNodes(e: Editor): Array<{ calloutType: string; title: string; number: string }> {
  const found: Array<{ calloutType: string; title: string; number: string }> = []
  e.state.doc.descendants((node) => {
    if (node.type.name === 'callout') {
      found.push({
        calloutType: node.attrs['calloutType'] as string,
        title: node.attrs['title'] as string,
        number: node.attrs['number'] as string,
      })
    }
    return true
  })
  return found
}

describe('Callout proof/theorem blocks (P6-1)', () => {
  it('parses a numbered theorem and round-trips its number and title', () => {
    const md = '> [!THEOREM 3.2] Squeeze Theorem\n> Let f, g, h be functions.'
    const e = mount(md)
    expect(calloutNodes(e)).toEqual([{ calloutType: 'theorem', title: 'Squeeze Theorem', number: '3.2' }])
    expect(getMarkdown(e)).toContain('[!THEOREM 3.2] Squeeze Theorem')
  })

  it('parses an unnumbered, untitled proof block', () => {
    const md = '> [!PROOF]\n> Trivial.'
    const e = mount(md)
    expect(calloutNodes(e)).toEqual([{ calloutType: 'proof', title: '', number: '' }])
    const out = getMarkdown(e)
    expect(out).toContain('[!PROOF]')
    expect(out).not.toContain('[!PROOF ')
  })

  it('round-trips lemma, corollary, definition and example types', () => {
    for (const type of ['LEMMA', 'COROLLARY', 'DEFINITION', 'EXAMPLE']) {
      const md = `> [!${type}] Title\n> Body.`
      const e = mount(md)
      expect(calloutNodes(e)).toEqual([{ calloutType: type.toLowerCase(), title: 'Title', number: '' }])
      expect(getMarkdown(e)).toContain(`[!${type}] Title`)
    }
  })
})

describe('Algorithm blocks (P6-2)', () => {
  it('round-trips as a plain, portable Markdown blockquote with bold slot labels', () => {
    // One blank-line-separated paragraph per slot — what /Algorithm Block
    // actually inserts (see SlashCommands.tsx), and how the DoD's "inserts
    // from / and round-trips" is meant to be exercised.
    const md =
      '> [!ALGORITHM] Dijkstra\n>\n> **Complexity:**\n>\n> O((V + E) log V)\n>\n> **Pseudocode:**\n>\n> ```\n> for each vertex...\n> ```'
    const e = mount(md)
    expect(calloutNodes(e)).toEqual([{ calloutType: 'algorithm', title: 'Dijkstra', number: '' }])
    const out = getMarkdown(e)
    expect(out).toContain('[!ALGORITHM] Dijkstra')
    expect(out).toContain('**Complexity:**')
    expect(out).toContain('**Pseudocode:**')
  })
})

describe('Callout parser: marker line sharing a paragraph with body text (P6-1/P6-2 fix)', () => {
  // Pre-existing bug, found while building P6-2: a blockquote line right
  // under the marker with no blank line before it is the *same* Markdown
  // paragraph as the marker (a soft line break), and the old parser deleted
  // that whole paragraph — marker and body both — rather than just the
  // marker. Real content loss, not cosmetic.
  it('keeps body text that shares a paragraph with the marker line', () => {
    const md = '> [!NOTE] Title\n> line one'
    const e = mount(md)
    expect(getMarkdown(e)).toContain('line one')
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
