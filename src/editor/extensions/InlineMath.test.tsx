import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'
import { useMathEditorStore } from '../../store/mathEditor'

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

  // P12-1: a copy action alongside the editor overlay's existing
  // edit/commit/cancel controls.
  it('copies the raw LaTeX source via the copy button in the editor overlay', async () => {
    // `userEvent.setup()` installs its own clipboard stub on `navigator` —
    // this mock has to be set up *after* it, or setup() silently
    // overwrites it.
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const { container } = mount('the identity $e^{i\\pi} + 1 = 0$ is neat')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    await waitFor(() => expect(getInput(container)).toBeInTheDocument())

    const copyButton = container.querySelector('.math-copy-button') as HTMLButtonElement
    expect(copyButton).toBeInTheDocument()
    await user.click(copyButton)

    expect(writeText).toHaveBeenCalledWith('e^{i\\pi} + 1 = 0')
  })

  // P12-3: the offending span gets marked in the source itself, not just
  // named in the message below it.
  it('marks the offending span in the source when the draft fails to parse', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'inlineMath', attrs: { latex: '' } })
    const input = await waitFor(() => {
      const el = getInput(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.type(input, '\\alpa')
    await waitFor(() => expect(container.querySelector('.math-editor-error')).toBeInTheDocument())

    const mark = container.querySelector('.math-error-mark')
    expect(mark).toBeInTheDocument()
    expect(mark!.textContent).toBe('\\alpa')
  })

  it('renders a caret marker, not an empty span, for a zero-length end-of-input error', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'inlineMath', attrs: { latex: '' } })
    const input = await waitFor(() => {
      const el = getInput(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    // Pasted, not typed: typing `{` would auto-close it into a valid group.
    await user.click(input)
    await user.paste('x_{')
    await waitFor(() => expect(container.querySelector('.math-editor-error')).toBeInTheDocument())

    expect(container.querySelector('.math-error-mark .math-error-caret')).toBeInTheDocument()
  })

  // P12-4 follow-up: the symbol palette moved to the top toolbar, outside
  // this node view entirely — this is the node view's half of that contract,
  // the toolbar's own half (InsertGroup) is covered in insertGroup.test.tsx.
  it('registers an insertSymbol handle with the math editor store while open', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'inlineMath', attrs: { latex: '' } })
    const input = await waitFor(() => {
      const el = getInput(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.type(input, 'x = ')

    const active = useMathEditorStore.getState().activeEditor
    expect(active).not.toBeNull()
    active!.insertSymbol('\\alpha')

    await waitFor(() => expect(getInput(container)!.value).toBe('x = \\alpha'))
  })

  it('unregisters from the math editor store once the editor closes', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'inlineMath', attrs: { latex: '' } })
    const input = await waitFor(() => {
      const el = getInput(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    expect(useMathEditorStore.getState().activeEditor).not.toBeNull()

    await user.type(input, 'x{Escape}')
    await waitFor(() => expect(useMathEditorStore.getState().activeEditor).toBeNull())
  })
})

beforeEach(() => useMathEditorStore.setState({ activeEditor: null, activeEditorId: null }))
