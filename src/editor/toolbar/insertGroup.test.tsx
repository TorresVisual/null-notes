import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { coreExtensions } from '../extensions'
import { InsertGroup } from './InsertGroup'

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
})
