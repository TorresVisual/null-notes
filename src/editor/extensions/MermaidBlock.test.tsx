import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'

function TestEditor({ content, onReady }: { content: string; onReady: (editor: Editor) => void }) {
  const instance = useEditor({ extensions: coreExtensions, content })
  useEffect(() => {
    if (instance) onReady(instance)
  }, [instance])
  return <EditorContent editor={instance} />
}

function mount(content: string) {
  let editor: Editor | null = null
  const result = render(<TestEditor content={content} onReady={(e) => { editor = e }} />)
  return { ...result, getEditor: () => editor! }
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement | null {
  return container.querySelector<HTMLTextAreaElement>('.mermaid-block-editor')
}

function mermaidCode(editor: Editor): string {
  let found = ''
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'mermaidBlock') found = node.attrs.code as string
    return true
  })
  return found
}

describe('mermaid block click-to-edit', () => {
  const source = '```mermaid\ngraph TD;\nA-->B;\n```'

  it('opens a code editor on click, seeded with the current source', async () => {
    const user = userEvent.setup()
    const { container } = mount(source)
    await waitFor(() => expect(container.querySelector('.mermaid-block-preview')).toBeInTheDocument())
    await user.click(container.querySelector('.mermaid-block-preview')!)
    await waitFor(() => expect(getTextarea(container)).toBeInTheDocument())
    expect(getTextarea(container)!.value).toBe('graph TD;\nA-->B;')
  })

  it('commits the edited source on Mod-Enter without leaving WYSIWYG view', async () => {
    const user = userEvent.setup()
    const { container, getEditor } = mount(source)
    await waitFor(() => expect(container.querySelector('.mermaid-block-preview')).toBeInTheDocument())
    await user.click(container.querySelector('.mermaid-block-preview')!)
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.clear(textarea)
    await user.type(textarea, 'graph TD;\nA-->C;')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(mermaidCode(getEditor())).toBe('graph TD;\nA-->C;'))
    expect(getTextarea(container)).not.toBeInTheDocument()
  })

  it('discards the draft on Escape', async () => {
    const user = userEvent.setup()
    const { container, getEditor } = mount(source)
    await waitFor(() => expect(container.querySelector('.mermaid-block-preview')).toBeInTheDocument())
    await user.click(container.querySelector('.mermaid-block-preview')!)
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.type(textarea, 'garbage')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(getTextarea(container)).not.toBeInTheDocument())
    expect(mermaidCode(getEditor())).toBe('graph TD;\nA-->B;')
  })
})
