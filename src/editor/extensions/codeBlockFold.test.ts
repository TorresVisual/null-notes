import { describe, it, expect, afterEach } from 'vitest'
import { splitLines, foldEndIndex } from './CodeBlockToolbar'

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

describe('splitLines (pure)', () => {
  it('marks a blank line with Infinity indent', () => {
    expect(splitLines('a\n\nb').map((l) => l.indent)).toEqual([0, Infinity, 0])
  })

  it('reads leading-space indentation', () => {
    expect(splitLines('if x:\n    return x').map((l) => l.indent)).toEqual([0, 4])
  })
})

describe('foldEndIndex (pure)', () => {
  it('is null for a line whose next line is not indented deeper', () => {
    const lines = splitLines('a\nb')
    expect(foldEndIndex(lines, 0)).toBeNull()
  })

  it('folds through every consecutively deeper-indented line', () => {
    const lines = splitLines('def f():\n    a\n    b\nc')
    expect(foldEndIndex(lines, 0)).toBe(2)
  })

  it('stops at the first line back at or above the base indent', () => {
    const lines = splitLines('if a:\n    x\nelif b:\n    y')
    expect(foldEndIndex(lines, 0)).toBe(1)
    expect(foldEndIndex(lines, 2)).toBe(3)
  })

  it('keeps a blank line inside the fold when deeper content follows it', () => {
    const lines = splitLines('def f():\n    a\n\n    b\nc')
    expect(foldEndIndex(lines, 0)).toBe(3)
  })

  it('never ends a fold on a dangling blank line', () => {
    const lines = splitLines('def f():\n    a\n\nc')
    expect(foldEndIndex(lines, 0)).toBe(1)
  })

  it('is null for a blank line', () => {
    const lines = splitLines('a\n\n    b')
    expect(foldEndIndex(lines, 1)).toBeNull()
  })
})

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

function codeBlock(text: string): string {
  return `<pre><code>${text}</code></pre>`
}

function foldableMarkers(e: InstanceType<typeof Editor>): HTMLElement[] {
  return [...e.view.dom.querySelectorAll('.code-line-number.foldable')] as HTMLElement[]
}

function clickFold(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('code folding (P11-3)', () => {
  it('marks a fold-start line foldable and leaves a flat line alone', () => {
    const e = mount(codeBlock('def f():\n    return 1\nprint(f())'))
    const markers = foldableMarkers(e)
    expect(markers).toHaveLength(1)
    expect(markers[0]?.textContent).toContain('1')
  })

  it('hides the folded lines and shows a placeholder on click, without touching the document', () => {
    const e = mount(codeBlock('def f():\n    return 1\nprint(f())'))
    const storage = e.storage as unknown as { markdown: { getMarkdown: () => string } }
    const before = storage.markdown.getMarkdown()

    clickFold(foldableMarkers(e)[0]!)

    expect(e.view.dom.querySelector('.code-fold-hidden')).not.toBeNull()
    expect(e.view.dom.querySelector('.code-fold-placeholder')?.textContent).toContain('1 line')
    expect(e.view.dom.querySelector('.code-line-number.folded')).not.toBeNull()
    expect(storage.markdown.getMarkdown()).toBe(before)
  })

  it('unfolds again on a second click, restoring all lines', () => {
    const e = mount(codeBlock('def f():\n    return 1\nprint(f())'))
    const marker = foldableMarkers(e)[0]!

    clickFold(marker)
    expect(e.view.dom.querySelector('.code-fold-hidden')).not.toBeNull()

    clickFold(e.view.dom.querySelector('.code-line-number.foldable')!)
    expect(e.view.dom.querySelector('.code-fold-hidden')).toBeNull()
    expect(e.view.dom.querySelector('.code-fold-placeholder')).toBeNull()
  })

  it('clicking the placeholder itself also unfolds', () => {
    const e = mount(codeBlock('def f():\n    return 1\nprint(f())'))
    clickFold(foldableMarkers(e)[0]!)

    clickFold(e.view.dom.querySelector('.code-fold-placeholder')!)

    expect(e.view.dom.querySelector('.code-fold-hidden')).toBeNull()
  })

  it('keeps a fold in place after an edit lands before the block', () => {
    const e = mount(`<p>note</p>${codeBlock('def f():\n    return 1\nprint(f())')}`)
    clickFold(foldableMarkers(e)[0]!)
    expect(e.view.dom.querySelector('.code-fold-hidden')).not.toBeNull()

    e.commands.insertContentAt(0, 'more ')

    expect(e.view.dom.querySelector('.code-fold-hidden')).not.toBeNull()
  })
})
