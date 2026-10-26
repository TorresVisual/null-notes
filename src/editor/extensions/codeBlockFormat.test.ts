import { describe, it, expect, afterEach, vi } from 'vitest'

const format = vi.fn<(language: string, source: string, width: number, useTab: boolean) => Promise<string>>()
vi.mock('../../lib/tauri', () => ({ api: { codeFormat: { format } } }))

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount(language: string, text: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({
    element,
    extensions: coreExtensions,
    content: `<pre><code class="language-${language}">${text}</code></pre>`,
  })
  return editor
}

function formatButton(e: InstanceType<typeof Editor>): HTMLElement | null {
  return e.view.dom.querySelector('.code-block-format')
}

function click(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  editor?.destroy()
  editor = null
  format.mockReset()
})

describe('code block Format button', () => {
  it.each(['c', 'cpp', 'c++', 'java', 'python', 'json'])('appears on %s blocks', (language) => {
    expect(formatButton(mount(language, 'x'))).not.toBeNull()
    editor?.destroy()
  })

  it('is absent on other languages and on blocks with no language', () => {
    expect(formatButton(mount('rust', 'x'))).toBeNull()
    editor?.destroy()
    expect(formatButton(mount('', 'x'))).toBeNull()
  })

  it('replaces the block text with the tool output, dropping its trailing newline', async () => {
    format.mockResolvedValue('int main() {\n  return 0;\n}\n')
    const e = mount('cpp', 'int main(){return 0;}')
    click(formatButton(e) as HTMLElement)
    await settle()

    expect(format).toHaveBeenCalledWith('cpp', 'int main(){return 0;}', 2, false)
    expect(e.state.doc.textContent).toBe('int main() {\n  return 0;\n}')
  })

  it('is one undo step', async () => {
    format.mockResolvedValue('a = 1\n')
    const e = mount('python', 'a=1')
    click(formatButton(e) as HTMLElement)
    await settle()
    expect(e.state.doc.textContent).toBe('a = 1')

    e.commands.undo()
    expect(e.state.doc.textContent).toBe('a=1')
  })

  it('formats JSON in the frontend without calling the backend', async () => {
    const e = mount('json', '{&quot;a&quot;:[1,2]}')
    click(formatButton(e) as HTMLElement)
    await settle()

    expect(format).not.toHaveBeenCalled()
    expect(e.state.doc.textContent).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
  })

  it('leaves the block alone and flags the button when JSON does not parse', async () => {
    const e = mount('json', '{oops')
    const button = formatButton(e) as HTMLElement
    click(button)
    await settle()

    expect(e.state.doc.textContent).toBe('{oops')
    expect(button.textContent).toBe('Failed')
    expect(button.classList.contains('failed')).toBe(true)
  })

  it('reports a missing tool distinctly', async () => {
    format.mockRejectedValue('clang-format is not installed or not on PATH')
    const button = formatButton(mount('java', 'class A{}')) as HTMLElement
    click(button)
    await settle()

    expect(button.textContent).toBe('Not installed')
    expect(button.title).toContain('clang-format')
  })

  it('discards the result if the block was edited while the tool ran', async () => {
    let resolve: (value: string) => void = () => {}
    format.mockReturnValue(new Promise<string>((r) => (resolve = r)))
    const e = mount('python', 'a=1')
    click(formatButton(e) as HTMLElement)

    e.commands.insertContentAt(e.state.doc.content.size - 1, 'b')
    resolve('a = 1\n')
    await settle()

    expect(e.state.doc.textContent).toBe('a=1b')
  })
})
