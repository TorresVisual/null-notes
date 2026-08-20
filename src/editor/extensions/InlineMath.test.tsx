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
  const el = container.querySelector('.inline-math-render')
  if (!el) throw new Error('inline-math-render not found')
  return el as HTMLElement
}

function getInput(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('.math-editor-input')
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('inline math editing — interactive', () => {
  it('opens the in-place editor on click, seeded with the committed latex', async () => {
    const user = userEvent.setup()
    const { container } = mount('the identity $e^{i\\pi} + 1 = 0$ is neat')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    await waitFor(() => expect(getInput(container)).toBeInTheDocument())
    expect(getInput(container)!.value).toBe('e^{i\\pi} + 1 = 0')
  })

  it('opens the editor via keyboard (Enter) on the rendered formula, not just a click', async () => {
    const user = userEvent.setup()
    const { container } = mount('the identity $e^{i\\pi} + 1 = 0$ is neat')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    getRender(container).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(getInput(container)).toBeInTheDocument())
    expect(getInput(container)!.value).toBe('e^{i\\pi} + 1 = 0')
  })

  it('also opens on keyboard Space, not just Enter', async () => {
    const user = userEvent.setup()
    const { container } = mount('the identity $e^{i\\pi} + 1 = 0$ is neat')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    getRender(container).focus()
    await user.keyboard(' ')
    await waitFor(() => expect(getInput(container)).toBeInTheDocument())
  })
})
