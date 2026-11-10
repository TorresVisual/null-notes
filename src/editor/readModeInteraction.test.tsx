import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { platform } from '@tauri-apps/plugin-os'
import { NoteEditor } from './NoteEditor'
import { TooltipProvider } from '../components/ui/tooltip'
import { useMobileEditStore } from '../store/mobileEdit'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import type { InkData } from '../ink/types'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn().mockResolvedValue(false),
  message: vi.fn().mockResolvedValue(undefined),
}))

const EMPTY_INK: InkData = { originX: 0, originY: 0, width: 700, height: 400, strokes: [], shapes: [], texts: [] }

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: () => Promise.resolve(EMPTY_INK),
    write: () => Promise.resolve(),
  },
}))

const INK_FENCE = '```ink\n{"src":"/ws/N.ink/a.svg","width":700,"height":400}\n```'

function checkbox(index: number): HTMLElement {
  const el = screen.getAllByRole('checkbox')[index]
  if (!el) throw new Error(`no checkbox at ${index}`)
  return el
}

function mount(content: string, onChange: (markdown: string) => void = () => {}) {
  return render(
    <TooltipProvider>
      <NoteEditor
        content={content}
        notePath="/a.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={onChange}
        onFlashcardCommand={() => {}}
      />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.mocked(platform).mockReturnValue('android')
  useMobileEditStore.setState({ editingPath: null })
})

afterEach(() => {
  cleanup()
  vi.mocked(platform).mockReturnValue('windows')
})

describe('interactive content in read mode', () => {
  it('a task checkbox toggles the document and reports the new markdown, every time', async () => {
    const onChange = vi.fn()
    mount('- [ ] one\n- [ ] two', onChange)
    expect(screen.getByRole('textbox', { name: 'Note' }).getAttribute('contenteditable')).toBe('false')

    fireEvent.click(checkbox(0))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('[x] one')))
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('[ ] two'))

    fireEvent.click(checkbox(0))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('[ ] one')))
  })

  it('toggles the item that was tapped, not an identical earlier one', async () => {
    const onChange = vi.fn()
    mount('- [ ] same\n- [ ] same', onChange)

    fireEvent.click(checkbox(1))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.lastCall?.[0]).toMatch(/\[ \] same\s+.*\[x\] same/s)
  })

  it('a wiki-link tap still opens its note', async () => {
    const openTab = vi.fn()
    useWorkspaceStore.setState({ openTab })
    useNotesStore.setState({
      notes: [{ id: '1', title: 'Big O Notation', path: '/ws/big-o.md', workspace: '/ws', updatedAt: 0 }],
    })
    const { container } = mount('<p><span data-type="wiki-link" data-title="Big O Notation"></span></p>')

    const link = await waitFor(() => {
      const el = container.querySelector('.wiki-link:not(.wiki-link-missing)')
      if (!el) throw new Error('wiki-link not rendered')
      return el
    })
    fireEvent.click(link)

    expect(openTab).toHaveBeenCalledWith('/ws/big-o.md')
  })

  it('tapping an ink preview opens the full-screen ink editor', async () => {
    const { container } = mount(INK_FENCE)

    const preview = await waitFor(() => {
      const el = container.querySelector('.ink-preview')
      if (!el) throw new Error('preview not mounted')
      return el
    })
    expect(screen.queryByLabelText('Edit drawing')).toBeNull()
    fireEvent.click(preview)

    await waitFor(() => expect(document.querySelector('.ink-editor-overlay')).not.toBeNull())
  })
})
