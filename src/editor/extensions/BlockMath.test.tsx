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
    expect(mathNodes(editor!)).toEqual([{ latex: 'b^3', number: null }])
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
    expect(mathNodes(editor!)).toEqual([{ latex: 'e^{i\\pi} + 1 = 0', number: null }])
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

  // P6-4: the "/" trigger reimplemented for LaTeX-source editing, since the
  // textarea is a plain form control outside ProseMirror and the editor-wide
  // slash-command plugin can never see typing inside it.
  it('inserts an equation snippet on Enter after a "/" query', async () => {
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    const user = userEvent.setup()
    await user.type(textarea, '/gradient{Enter}')
    await waitFor(() => expect(getTextarea(container)!.value).toBe('\\nabla f(x)'))

    await user.type(textarea, '{Control>}{Enter}{/Control}')
    await waitFor(() => expect(mathNodes(editor!)).toEqual([{ latex: '\\nabla f(x)', number: null }]))
  })

  it('completes a \\command with Tab, keeping Enter as a newline', async () => {
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    const user = userEvent.setup()
    await user.type(textarea, '\\alph')
    await user.keyboard('{Enter}')
    expect(textarea.value).toBe('\\alph\n')
    await user.keyboard('{Backspace}{Tab}')
    await waitFor(() => expect(textarea.value).toBe('\\alpha'))
  })

  it('pairs braces, Tabs between {} slots, and overtypes the closer', async () => {
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    const user = userEvent.setup()
    await user.type(textarea, '/frac{Enter}')
    await waitFor(() => expect(textarea.selectionStart).toBe(6))
    await user.keyboard('a{Tab}b')
    expect(textarea.value).toBe('\\frac{a}{b}')

    await user.keyboard('{Tab}^{{')
    await waitFor(() => expect(textarea.value).toBe('\\frac{a}{b}^{}'))
    await waitFor(() => expect(textarea.selectionStart).toBe(13))
    await user.keyboard('2}')
    expect(textarea.value).toBe('\\frac{a}{b}^{2}')
    expect(textarea.selectionStart).toBe(15)
  })

  it('opens the editor via keyboard (Enter) on the rendered formula, not just a click', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    getRender(container).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(getTextarea(container)).toBeInTheDocument())
    expect(getTextarea(container)!.value).toBe('e^{i\\pi} + 1 = 0')
  })

  it('opens directly into edit mode for a freshly inserted empty node, and Escape deletes it', async () => {
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    await waitFor(() => expect(getTextarea(container)).toBeInTheDocument())
    const user = userEvent.setup()
    await user.type(getTextarea(container)!, '{Escape}')
    await waitFor(() => expect(mathNodes(editor!)).toHaveLength(0))
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

    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    await waitFor(() => expect(getTextarea(container)).toBeInTheDocument())

    const copyButton = container.querySelector('.math-copy-button') as HTMLButtonElement
    expect(copyButton).toBeInTheDocument()
    await user.click(copyButton)

    expect(writeText).toHaveBeenCalledWith('e^{i\\pi} + 1 = 0')
  })

  // P12-2: the number typed here is what makes the equation resolvable as
  // `Equation (N)` elsewhere in the workspace.
  it('sets the equation number from the editor overlay and shows it once committed', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    const numberInput = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('.block-math-number-input')
      if (!el) throw new Error('number input not open yet')
      return el
    })

    await user.type(numberInput, '3{Control>}{Enter}{/Control}')

    await waitFor(() => expect(mathNodes(editor!)).toEqual([{ latex: 'e^{i\\pi} + 1 = 0', number: '3' }]))
    expect(container.querySelector('.block-math-number')?.textContent).toBe('(3)')
  })

  // P12-3: the offending span gets marked in the source itself, not just
  // named in the message below it.
  it('marks the offending span in the source when the draft fails to parse', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.type(textarea, '\\alpa')
    await waitFor(() => expect(container.querySelector('.block-math-editor-error')).toBeInTheDocument())

    const mark = container.querySelector('.math-error-mark')
    expect(mark).toBeInTheDocument()
    expect(mark!.textContent).toBe('\\alpa')
  })

  it('renders a caret marker, not an empty span, for a zero-length end-of-input error', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    // Pasted, not typed: typing `{` would auto-close it into a valid group.
    await user.click(textarea)
    await user.paste('x_{')
    await waitFor(() => expect(container.querySelector('.block-math-editor-error')).toBeInTheDocument())

    expect(container.querySelector('.math-error-mark .math-error-caret')).toBeInTheDocument()
  })

  // P12-4 follow-up: the symbol palette moved to the top toolbar, outside
  // this node view entirely — this is the node view's half of that contract,
  // the toolbar's own half (InsertGroup) is covered in insertGroup.test.tsx.
  it('registers an insertSymbol handle with the math editor store while open', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.type(textarea, 'x = ')

    const active = useMathEditorStore.getState().activeEditor
    expect(active).not.toBeNull()
    active!.insertSymbol('\\alpha')

    await waitFor(() => expect(getTextarea(container)!.value).toBe('x = \\alpha'))
  })

  it('unregisters from the math editor store once the editor closes', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    expect(useMathEditorStore.getState().activeEditor).not.toBeNull()

    await user.type(textarea, 'x{Escape}')
    await waitFor(() => expect(useMathEditorStore.getState().activeEditor).toBeNull())
  })
})

beforeEach(() => useMathEditorStore.setState({ activeEditor: null, activeEditorId: null }))

afterEach(() => {
  editor?.destroy()
  editor = null
})
