import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { coreExtensions } from '../extensions'
import { TextFormatGroup } from './TextFormatGroup'

let editor: Editor | null = null

// `selectAll()` produces an `AllSelection`, which — after StarterKit's
// trailing-node plugin appends an empty paragraph behind a heading or list —
// keeps spanning both nodes, so `isActive` never sees a pure match. A plain
// text selection over the paragraph's own content maps normally instead.
function mount(content: string) {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
  return render(<TextFormatGroup editor={editor} />)
}

afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
})

describe('the text formatting group', () => {
  it('bolds the selection', async () => {
    const { getByLabelText } = mount('<p>hello</p>')

    fireEvent.click(getByLabelText('Bold'))

    await waitFor(() => expect(editor!.isActive('bold')).toBe(true))
  })

  it('marks the button active when the selection is already bold', async () => {
    const { getByLabelText } = mount('<p><strong>hello</strong></p>')

    await waitFor(() => expect(getByLabelText('Bold')).toHaveAttribute('aria-pressed', 'true'))
  })

  it('turns the selection into a heading', async () => {
    const { getByLabelText } = mount('<p>hello</p>')

    fireEvent.click(getByLabelText('Heading 2'))

    await waitFor(() => expect(editor!.isActive('heading', { level: 2 })).toBe(true))
  })

  it('turns the selection into a bullet list', async () => {
    const { getByLabelText } = mount('<p>hello</p>')

    fireEvent.click(getByLabelText('Bullet list'))

    await waitFor(() => expect(editor!.isActive('bulletList')).toBe(true))
  })

  it('colors the selection and keeps it when the highlight is added', async () => {
    const { getByLabelText } = mount('<p>hello</p>')

    fireEvent.click(getByLabelText('Text color'))
    fireEvent.click(getByLabelText('#ef4444'))
    fireEvent.click(getByLabelText('Highlight color'))
    fireEvent.click(getByLabelText('#eab308'))

    await waitFor(() => expect(editor!.getAttributes('spanStyle')).toMatchObject({ color: '#ef4444', backgroundColor: '#eab30859' }))
    const storage = (editor!.storage as unknown as Record<string, { getMarkdown: () => string }>)['markdown']
    expect(storage!.getMarkdown()).toContain('color: rgb(239, 68, 68)')
  })

  it('clears the color back to default and drops the mark', async () => {
    const { getByLabelText, getByText } = mount('<p><span style="color: red">hello</span></p>')

    fireEvent.click(getByLabelText('Text color'))
    fireEvent.click(getByText('Default'))

    await waitFor(() => expect(editor!.isActive('spanStyle')).toBe(false))
  })
})
