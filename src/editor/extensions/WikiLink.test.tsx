import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'
import { useNotesStore } from '../../store/notes'
import { TooltipProvider } from '../../components/ui/tooltip'

vi.mock('../../lib/tauri', () => ({
  api: { notes: { open: vi.fn() } },
}))

const { api } = await import('../../lib/tauri')
const openNote = vi.mocked(api.notes.open)

let editor: Editor | null = null

function TestEditor({ content, onReady }: { content: string; onReady: (editor: Editor) => void }) {
  const instance = useEditor({ extensions: coreExtensions, content })
  useEffect(() => {
    if (instance) onReady(instance)
  }, [instance])
  return (
    <TooltipProvider>
      <EditorContent editor={instance} />
    </TooltipProvider>
  )
}

function mount(content: string) {
  return render(<TestEditor content={content} onReady={(e) => { editor = e }} />)
}

function getWikiLink(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.wiki-link:not(.wiki-link-missing)')
  if (!(el instanceof HTMLElement)) throw new Error('no resolved wiki-link rendered')
  return el
}

beforeEach(() => {
  openNote.mockReset()
  useNotesStore.setState({
    notes: [{ id: '1', title: 'Big O Notation', path: '/ws/big-o.md', workspace: '/ws', updatedAt: 0 }],
  })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('WikiLinkView preview', () => {
  it('fetches and shows a preview excerpt only after the link is hovered', async () => {
    const user = userEvent.setup()
    openNote.mockResolvedValue('# Big O Notation\nBounds on growth rate.')
    const { container } = mount('<p><span data-type="wiki-link" data-title="Big O Notation"></span></p>')
    await waitFor(() => expect(getWikiLink(container)).toBeInTheDocument())

    expect(openNote).not.toHaveBeenCalled()

    await user.hover(getWikiLink(container))

    await waitFor(() => expect(openNote).toHaveBeenCalledWith('/ws', '/ws/big-o.md'))
    // Tooltip content renders via a Radix Portal into document.body, outside
    // RTL's own `container` — query the document, not the container.
    await waitFor(() => expect(document.querySelector('.wiki-link-preview')?.textContent).toBe('Bounds on growth rate.'))
  })

  it('does not fetch a preview for an unresolved link', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p><span data-type="wiki-link" data-title="Nonexistent"></span></p>')
    await waitFor(() => expect(container.querySelector('.wiki-link-missing')).toBeInTheDocument())

    const missing = container.querySelector('.wiki-link-missing')
    if (missing instanceof HTMLElement) await user.hover(missing)

    expect(openNote).not.toHaveBeenCalled()
  })

  it('only fetches once across repeated hovers', async () => {
    const user = userEvent.setup()
    openNote.mockResolvedValue('# Big O Notation\nBounds on growth rate.')
    const { container } = mount('<p><span data-type="wiki-link" data-title="Big O Notation"></span></p>')
    await waitFor(() => expect(getWikiLink(container)).toBeInTheDocument())

    await user.hover(getWikiLink(container))
    await waitFor(() => expect(openNote).toHaveBeenCalledTimes(1))

    await user.unhover(getWikiLink(container))
    await user.hover(getWikiLink(container))

    expect(openNote).toHaveBeenCalledTimes(1)
  })
})

describe('WikiLink [[ autocomplete', () => {
  it('shows matching note titles and inserts a wiki-link node on selection', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    await waitFor(() => expect(editor).not.toBeNull())

    editor?.commands.focus('end')
    // userEvent.type treats "[" as a special-key meta character; "[[" doubled
    // escapes it down to a literal "[[" in the document.
    await user.type(container.querySelector('.tiptap') as HTMLElement, '[[[[Big O')

    const item = await waitFor(() => {
      const el = document.querySelector('.slash-menu-item')
      if (!el) throw new Error('menu not rendered')
      return el
    })
    expect(item.textContent).toBe('Big O Notation')

    await user.click(item)

    await waitFor(() => expect(getWikiLink(container)).toBeInTheDocument())
    expect(editor?.getText()).toBe('')
  })

  it('offers a "create note" entry for a title that does not exist yet', async () => {
    const user = userEvent.setup()
    const { container } = mount('<p></p>')
    await waitFor(() => expect(editor).not.toBeNull())

    editor?.commands.focus('end')
    await user.type(container.querySelector('.tiptap') as HTMLElement, '[[[[Brand New Note')

    const items = await waitFor(() => {
      const els = document.querySelectorAll('.slash-menu-item')
      if (!els.length) throw new Error('menu not rendered')
      return Array.from(els)
    })
    expect(items.some((el) => el.textContent === 'Create note "Brand New Note"')).toBe(true)
  })
})
