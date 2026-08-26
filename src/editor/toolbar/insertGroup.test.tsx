import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Editor } from '@tiptap/core'
import { coreExtensions } from '../extensions'
import { InsertGroup } from './InsertGroup'
import { useMathEditorStore } from '../../store/mathEditor'

vi.mock('../../lib/ink', () => ({
  inkApi: { ensureDir: () => Promise.resolve('/ws/N.ink'), write: () => Promise.resolve() },
}))

let editor: Editor | null = null

function mount() {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content: '<p></p>' })
  editor.storage.noteContext.notePath = '/ws/N.md'
  return render(<InsertGroup editor={editor} notePath="/ws/N.md" />)
}

function nodeTypes(): string[] {
  const found: string[] = []
  editor!.state.doc.descendants((node) => { found.push(node.type.name); return true })
  return found
}

function nodesOfType(type: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  editor!.state.doc.descendants((node) => {
    if (node.type.name === type) found.push(node.attrs)
    return true
  })
  return found
}

beforeEach(() => useMathEditorStore.setState({ activeEditor: null, activeEditorId: null }))

afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
})

describe('the insert group', () => {
  it('inserts a block equation', async () => {
    const { getByLabelText } = mount()

    fireEvent.click(getByLabelText('Insert equation'))

    await waitFor(() => expect(nodeTypes()).toContain('blockMath'))
  })

  it('inserts a table', async () => {
    const { getByLabelText } = mount()

    fireEvent.click(getByLabelText('Insert table'))

    await waitFor(() => expect(nodeTypes()).toContain('table'))
  })

  it('inserts a code block', async () => {
    const { getByLabelText } = mount()

    fireEvent.click(getByLabelText('Insert code block'))

    await waitFor(() => expect(nodeTypes()).toContain('codeBlock'))
  })

  it('inserts an ink canvas backed by a sidecar', async () => {
    const { getByLabelText } = mount()

    fireEvent.click(getByLabelText('Insert ink canvas'))

    await waitFor(() => expect(nodeTypes()).toContain('inkBlock'))
  })

  // P12-4 follow-up: the symbol palette lives here now, not inside either
  // math node's own editing overlay.
  describe('the symbol palette', () => {
    it('seeds a fresh inline-math node when no equation is open', async () => {
      const user = userEvent.setup()
      const { getByLabelText, container } = mount()

      await user.click(getByLabelText('Symbol palette'))
      const search = await waitFor(() => {
        const el = container.querySelector<HTMLInputElement>('.symbol-palette-search')
        if (!el) throw new Error('palette not open yet')
        return el
      })
      await user.type(search, 'alpha')
      const alphaButton = await waitFor(() => {
        const el = container.querySelector<HTMLButtonElement>('.symbol-palette-item[title^="alpha"]')
        if (!el) throw new Error('alpha symbol not found')
        return el
      })
      await user.click(alphaButton)

      await waitFor(() => expect(nodesOfType('inlineMath')).toEqual([{ latex: '\\alpha' }]))
      expect(container.querySelector('.symbol-palette')).not.toBeInTheDocument()
    })

    it('inserts into the open equation instead, when one is active', async () => {
      const user = userEvent.setup()
      const insertSymbol = vi.fn()
      useMathEditorStore.getState().setActiveEditor('fake', { insertSymbol, commitAndClose: vi.fn() })

      const { getByLabelText, container } = mount()
      await user.click(getByLabelText('Symbol palette'))
      const search = await waitFor(() => {
        const el = container.querySelector<HTMLInputElement>('.symbol-palette-search')
        if (!el) throw new Error('palette not open yet')
        return el
      })
      await user.type(search, 'alpha')
      const alphaButton = await waitFor(() => {
        const el = container.querySelector<HTMLButtonElement>('.symbol-palette-item[title^="alpha"]')
        if (!el) throw new Error('alpha symbol not found')
        return el
      })
      await user.click(alphaButton)

      expect(insertSymbol).toHaveBeenCalledWith('\\alpha')
      expect(nodeTypes()).not.toContain('inlineMath')
    })
  })
})
