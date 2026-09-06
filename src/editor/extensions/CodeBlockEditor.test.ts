import { describe, it, expect, afterEach } from 'vitest'

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount(content = '<p></p>') {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

// jsdom has no ClipboardEvent/DataTransfer constructors, so build the
// minimal shape the plugin's handlePaste actually reads.
function vscodePaste(e: InstanceType<typeof Editor>, text: string, mode: string): boolean {
  const clipboardData = {
    getData: (type: string) => {
      if (type === 'text/plain') return text
      if (type === 'vscode-editor-data') return JSON.stringify({ mode })
      return ''
    },
  }
  let handled = false
  e.view.someProp('handlePaste', (f) => {
    if (f(e.view, { clipboardData } as unknown as ClipboardEvent, e.view.state.selection.content())) handled = true
  })
  return handled
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('vscode-tagged paste', () => {
  it('does not wrap a markdown-mode paste in a code block', () => {
    const e = mount()
    const handled = vscodePaste(e, '# Heading\n\nSome text', 'markdown')
    expect(handled).toBe(false)
    expect(e.getJSON().content?.some((n) => n.type === 'codeBlock')).toBe(false)
  })

  it('still wraps a real language paste in a code block', () => {
    const e = mount()
    const handled = vscodePaste(e, 'print("hi")', 'python')
    expect(handled).toBe(true)
    const codeBlock = e.getJSON().content?.find((n) => n.type === 'codeBlock')
    expect(codeBlock?.attrs?.['language']).toBe('python')
  })
})
