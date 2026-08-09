import { describe, it, expect, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'

let editor: Editor | null = null

function TestEditor({ content, onReady }: { content: string; onReady: (editor: Editor) => void }) {
  const instance = useEditor({ extensions: coreExtensions, content })
  useEffect(() => {
    if (instance) onReady(instance)
  }, [instance])
  return <EditorContent editor={instance} />
}

function mount(content: string) {
  return render(<TestEditor content={content} onReady={(e) => { editor = e }} />)
}

function getRender(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.block-math-render')
  if (!el) throw new Error('block-math-render not found')
  return el as HTMLElement
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement | null {
  return container.querySelector<HTMLTextAreaElement>('.block-math-editor-input')
}

function mathNodes(instance: Editor): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  instance.state.doc.descendants((node) => {
    if (node.type.name === 'blockMath') found.push(node.attrs)
    return true
  })
  return found
}

describe('block math editing', () => {
  it('opens the in-place editor on click, seeded with the committed latex', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    await waitFor(() => expect(getTextarea(container)).toBeInTheDocument())
    expect(getTextarea(container)!.value).toBe('e^{i\\pi} + 1 = 0')
  })

  it('commits the draft on Mod-Enter and closes the editor', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.clear(textarea)
    await user.type(textarea, 'b^3{Control>}{Enter}{/Control}')
    await waitFor(() => expect(getTextarea(container)).toBeNull())
    expect(mathNodes(editor!)).toEqual([{ latex: 'b^3' }])
  })

  it('reverts to the committed latex and closes on Escape', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.clear(textarea)
    await user.type(textarea, 'garbage{Escape}')
    await waitFor(() => expect(getTextarea(container)).toBeNull())
    expect(mathNodes(editor!)).toEqual([{ latex: 'e^{i\\pi} + 1 = 0' }])
  })

  it('deletes the node when committing an empty draft', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.clear(textarea)
    await user.type(textarea, '{Control>}{Enter}{/Control}')
    await waitFor(() => expect(mathNodes(editor!)).toHaveLength(0))
  })

  it('opens directly into edit mode for a freshly inserted empty node, and Escape deletes it', async () => {
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    await waitFor(() => expect(getTextarea(container)).toBeInTheDocument())
    const user = userEvent.setup()
    await user.type(getTextarea(container)!, '{Escape}')
    await waitFor(() => expect(mathNodes(editor!)).toHaveLength(0))
  })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})
