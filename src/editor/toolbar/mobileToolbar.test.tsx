import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { coreExtensions } from '../extensions'
import { MobileToolbarItems } from './MobileToolbarItems'
import { ToolbarSettings } from '../../components/ToolbarSettings'
import { DEFAULT_SETTINGS, useSettingsStore } from '../../store/settings'
import { DEFAULT_TOOLBAR_ITEMS, hiddenToolbarItems, resolveToolbarItems } from './toolbarItems'

let editor: Editor | null = null

function mount(content: string, mobileToolbar: string[] | null = null) {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mobileToolbar } })
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return render(<MobileToolbarItems editor={editor} notePath="/a.md" />)
}

beforeEach(() => useSettingsStore.setState({ settings: DEFAULT_SETTINGS }))
afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
})

describe('the mobile toolbar items', () => {
  it('shows undo, redo, indent and outdent by default', () => {
    const { getByLabelText } = mount('<p>hi</p>')

    for (const label of ['Undo', 'Redo', 'Indent', 'Outdent']) expect(getByLabelText(label)).toBeInTheDocument()
  })

  it('renders only the saved items, in the saved order', () => {
    const { getAllByRole } = mount('<p>hi</p>', ['italic', 'bold'])

    expect(getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Italic', 'Bold'])
  })

  it('disables undo until there is something to undo, then undoes it', async () => {
    const { getByLabelText } = mount('<p>hi</p>')
    expect(getByLabelText('Undo')).toBeDisabled()

    editor!.commands.insertContent('x')
    await waitFor(() => expect(getByLabelText('Undo')).toBeEnabled())
    fireEvent.click(getByLabelText('Undo'))

    await waitFor(() => expect(editor!.getText()).toBe('hi'))
  })

  it('indents and outdents a nested list item', async () => {
    const { getByLabelText } = mount('<ul><li><p>a</p></li><li><p>b</p></li></ul>')
    editor!.commands.setTextSelection(editor!.state.doc.content.size - 3)

    fireEvent.click(getByLabelText('Indent'))
    await waitFor(() => expect(editor!.getHTML()).toMatch(/<p>a<\/p><ul/))

    fireEvent.click(getByLabelText('Outdent'))
    await waitFor(() => expect(editor!.getHTML()).not.toMatch(/<p>a<\/p><ul/))
  })

  it('drops a saved id this build no longer knows', () => {
    expect(resolveToolbarItems(['bold', 'gone']).map((i) => i.id)).toEqual(['bold'])
  })
})

describe('the toolbar settings', () => {
  it('hides, re-adds and reorders items through onChange', () => {
    const calls: (string[] | null)[] = []
    const { getByLabelText, rerender } = render(
      <ToolbarSettings saved={['bold', 'italic']} onChange={(ids) => calls.push(ids)} />,
    )

    fireEvent.click(getByLabelText('Hide Bold'))
    fireEvent.click(getByLabelText('Move Bold down'))
    fireEvent.click(getByLabelText('Add Undo'))

    expect(calls).toEqual([['italic'], ['italic', 'bold'], ['bold', 'italic', 'undo']])

    rerender(<ToolbarSettings saved={['italic']} onChange={() => {}} />)
    expect(getByLabelText('Add Bold')).toBeInTheDocument()
  })

  it('leaves hidden exactly the items the saved list omits, and resets to null', () => {
    expect(hiddenToolbarItems(null)).toEqual([])
    expect(hiddenToolbarItems(DEFAULT_TOOLBAR_ITEMS.slice(1)).map((i) => i.id)).toEqual([DEFAULT_TOOLBAR_ITEMS[0]])

    const calls: (string[] | null)[] = []
    const { getByText } = render(<ToolbarSettings saved={['bold']} onChange={(ids) => calls.push(ids)} />)
    fireEvent.click(getByText('Reset'))
    expect(calls).toEqual([null])
  })
})
