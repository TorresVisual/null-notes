import { describe, it, expect, afterEach, vi } from 'vitest'

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

function codeBlock(text: string, language = 'rust'): string {
  return `<pre><code class="language-${language}">${text}</code></pre>`
}

function gutters(e: InstanceType<typeof Editor>): HTMLElement[] {
  return [...e.view.dom.querySelectorAll('.code-line-numbers')] as HTMLElement[]
}

function actionsFor(e: InstanceType<typeof Editor>): HTMLElement {
  const el = e.view.dom.querySelector('.code-block-actions')
  if (!(el instanceof HTMLElement)) throw new Error('no code-block-actions rendered')
  return el
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('code block line numbers', () => {
  it('lists one number per source line', () => {
    const e = mount(codeBlock('fn main() {}\nlet x = 1;\nlet y = 2;'))
    const [gutter] = gutters(e)
    expect(gutter?.textContent).toBe('1\n2\n3')
  })

  it('renders exactly one number for a single-line block', () => {
    const e = mount(codeBlock('let x = 1;'))
    const [gutter] = gutters(e)
    expect(gutter?.textContent).toBe('1')
  })

  it('updates as lines are added', () => {
    const e = mount(codeBlock('one'))
    e.commands.insertContent('\ntwo')
    const [gutter] = gutters(e)
    expect(gutter?.textContent).toBe('1\n2')
  })

  it('renders a gutter per code block, not one for the whole document', () => {
    const e = mount(`${codeBlock('a')}${codeBlock('b')}`)
    expect(gutters(e)).toHaveLength(2)
  })
})

describe('code block copy button', () => {
  it('copies the block\'s text via the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const e = mount(codeBlock('fn main() {}'))
    const copy = actionsFor(e).querySelector('.code-block-copy')
    expect(copy).toBeInstanceOf(HTMLElement)

    copy?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(writeText).toHaveBeenCalledWith('fn main() {}')
  })

  it('shows transient "Copied" feedback after a successful copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const e = mount(codeBlock('let x = 1;'))
    const copy = actionsFor(e).querySelector('.code-block-copy') as HTMLElement
    copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(copy.textContent).toBe('Copied')
  })
})

describe('code block word-wrap toggle', () => {
  it('is off by default — no data-wrap on the rendered <pre>', () => {
    const e = mount(codeBlock('let x = 1;'))
    const pre = e.view.dom.querySelector('pre')
    expect(pre?.getAttribute('data-wrap')).toBe('false')
  })

  it('flips codeBlock.wrap and the rendered attribute on click', () => {
    const e = mount(codeBlock('let x = 1;'))
    const toggle = actionsFor(e).querySelector('.code-block-wrap-toggle') as HTMLElement
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const pre = e.view.dom.querySelector('pre')
    expect(pre?.getAttribute('data-wrap')).toBe('true')
    expect(e.getAttributes('codeBlock')['wrap']).toBe(true)
  })

  it('never reaches the markdown fence', () => {
    const e = mount(codeBlock('let x = 1;'))
    const toggle = actionsFor(e).querySelector('.code-block-wrap-toggle') as HTMLElement
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const storage = e.storage as unknown as { markdown: { getMarkdown: () => string } }
    const markdown = storage.markdown.getMarkdown()
    expect(markdown).not.toContain('wrap')
    expect(markdown.trim()).toBe('```rust\nlet x = 1;\n```')
  })
})
