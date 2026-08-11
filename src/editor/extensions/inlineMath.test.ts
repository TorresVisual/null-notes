import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content,
  })
  return editor
}

interface MarkdownStorage {
  getMarkdown: () => string
}

function markdown(instance: Editor): string {
  const storage = instance.storage as unknown as { markdown: MarkdownStorage }
  return storage.markdown.getMarkdown()
}

function mathNodes(instance: Editor): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  instance.state.doc.descendants((node) => {
    if (node.type.name === 'inlineMath') found.push(node.attrs)
    return true
  })
  return found
}

describe('inline math', () => {
  it('parses $…$ into a node rather than leaving literal text', () => {
    const e = mount('the identity $e^{i\\pi} + 1 = 0$ is neat')
    expect(mathNodes(e)).toEqual([{ latex: 'e^{i\\pi} + 1 = 0' }])
  })

  it('round-trips through markdown', () => {
    const source = 'the identity $e^{i\\pi} + 1 = 0$ is neat'
    expect(markdown(mount(source))).toBe(source)
  })

  it('keeps several equations on one line apart', () => {
    const e = mount('$a^2$ plus $b^2$')
    expect(mathNodes(e)).toEqual([{ latex: 'a^2' }, { latex: 'b^2' }])
  })

  // A lone dollar sign is a price, not the start of an equation.
  it('leaves an unpaired dollar sign as text', () => {
    const e = mount('it costs $5 today')
    expect(mathNodes(e)).toHaveLength(0)
  })

  // CommonMark treats `\\` as an escaped literal backslash — a real risk
  // for LaTeX, which uses `\\` as a matrix/cases row separator and `\{`,
  // `\_`, `\%` etc. constantly. If the equation's raw source passes through
  // markdown-it's ordinary backslash-escape processing before this node's
  // own parsing sees it, one of the two backslashes silently disappears.
  it('preserves a literal double backslash inside the equation', () => {
    const source = String.raw`$\begin{cases} 1 & a \\ 0 & b \end{cases}$`
    const e = mount(source)
    expect(mathNodes(e)).toEqual([{ latex: String.raw`\begin{cases} 1 & a \\ 0 & b \end{cases}` }])
  })

  // The real note that surfaced this: Analysis_2_Blatt12.pdf's Heaviside
  // step function, imported by the PDF pipeline (reconstruct_cases) with a
  // leading word sharing the equation's own sentence.
  it('preserves the row separator in an imported Heaviside cases block', () => {
    const source =
      'ist ' +
      String.raw`$H(t - b) = \begin{cases} 1 & \text{für} t \geq b \\ 0 & \text{für} t < b. \end{cases}$`
    const e = mount(source)
    expect(mathNodes(e)).toEqual([
      { latex: String.raw`H(t - b) = \begin{cases} 1 & \text{für} t \geq b \\ 0 & \text{für} t < b. \end{cases}` },
    ])
  })

  // The node view writes latex back through updateAttributes when the popover
  // commits; the edited value has to survive the next save.
  it('serializes an edited equation', () => {
    const e = mount('$a^2$')
    e.commands.setNodeSelection(1)
    e.commands.updateAttributes('inlineMath', { latex: 'b^3' })
    expect(markdown(e)).toBe('$b^3$')
  })

  it('wraps the selection on Mod-Shift-e', () => {
    const e = mount('x_1 here')
    e.commands.setTextSelection({ from: 1, to: 4 })
    e.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true, bubbles: true }),
    )
    expect(mathNodes(e)).toEqual([{ latex: 'x_1' }])
  })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})
