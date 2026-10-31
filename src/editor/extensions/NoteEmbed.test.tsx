import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { extensionsFor } from './index'
import { useNotesStore } from '../../store/notes'
import { TooltipProvider } from '../../components/ui/tooltip'

vi.mock('../../lib/tauri', () => ({
  api: { notes: { open: vi.fn() } },
}))

type ChangeHandler = (event: { payload: string[] }) => void | Promise<void>
const changeHandlers: ChangeHandler[] = []

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, handler: ChangeHandler) => {
    changeHandlers.push(handler)
    return Promise.resolve(() => {})
  }),
}))

const { api } = await import('../../lib/tauri')
const openNote = vi.mocked(api.notes.open)

let editor: Editor | null = null
let contents: Record<string, string> = {}

function TestEditor({ content, path, onReady }: { content: string; path: string; onReady: (editor: Editor) => void }) {
  const instance = useEditor({ extensions: extensionsFor(path), content })
  useEffect(() => {
    if (instance) onReady(instance)
  }, [instance])
  return (
    <TooltipProvider>
      <EditorContent editor={instance} />
    </TooltipProvider>
  )
}

function mount(content: string, path = '/ws/host.md') {
  return render(<TestEditor content={content} path={path} onReady={(e) => { editor = e }} />)
}

function markdownOf(): string | undefined {
  return (editor?.storage as unknown as { markdown: { getMarkdown(): string } } | undefined)?.markdown.getMarkdown()
}

function note(title: string) {
  return { id: title, title, path: `/ws/${title.toLowerCase()}.md`, workspace: '/ws', updatedAt: 0 }
}

beforeEach(() => {
  changeHandlers.length = 0
  contents = {}
  openNote.mockReset()
  openNote.mockImplementation(async (_workspace, path) => contents[path] ?? '')
  useNotesStore.setState({ notes: ['A', 'B', 'N1', 'N2', 'N3', 'N4', 'N5'].map(note) })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('NoteEmbed markdown', () => {
  it.each(['![[Big O]]', '![[Big O#Proofs]]', 'intro\n\n![[Big O]]\n\noutro'])(
    'renders %j as an embed and round-trips it unchanged',
    async (markdown) => {
      const { container } = mount(markdown)
      await waitFor(() => expect(container.querySelector('.note-embed')).toBeInTheDocument())

      expect(markdownOf()).toBe(markdown)
    },
  )

  it('leaves an inline ![[…]] as a wiki-link, not an embed', async () => {
    const { container } = mount('see ![[Big O]] inline')
    await waitFor(() => expect(container.querySelector('.wiki-link')).toBeInTheDocument())

    expect(container.querySelector('.note-embed')).toBeNull()
  })

  it('does not turn an embed inside a list item into an embed block', async () => {
    const { container } = mount('- ![[Big O]]')
    await waitFor(() => expect(editor).not.toBeNull())

    expect(container.querySelector('.note-embed')).toBeNull()
  })
})

describe('NoteEmbedView', () => {
  it('renders the whole target minus its H1, under a header naming the note', async () => {
    contents['/ws/b.md'] = '# B\nhello world'
    const { container } = mount('![[B]]')

    await waitFor(() => expect(container.querySelector('.note-embed-body')?.textContent).toContain('hello world'))
    expect(container.querySelector('.note-embed-body h1')).toBeNull()
    expect(container.querySelector('.note-embed-header')?.textContent).toBe('B')
    expect(markdownOf()).toBe('![[B]]')
  })

  it('renders only the named heading section', async () => {
    contents['/ws/b.md'] = '# B\n## Part\ninside\n## Other\noutside'
    const { container } = mount('![[B#Part]]')

    await waitFor(() => expect(container.querySelector('.note-embed-body')?.textContent).toContain('inside'))
    expect(container.querySelector('.note-embed-body')?.textContent).not.toContain('outside')
    expect(container.querySelector('.note-embed-header')?.textContent).toBe('B › Part')
  })

  it('shows a placeholder for a heading the target does not have', async () => {
    contents['/ws/b.md'] = '# B\nbody'
    const { container } = mount('![[B#Nope]]')

    await waitFor(() => expect(container.textContent).toContain('Heading "Nope" not found in "B"'))
  })

  it('shows a muted placeholder for an unresolved note', async () => {
    const { container } = mount('![[Ghost]]')

    await waitFor(() => expect(container.querySelector('.note-embed-missing')?.textContent).toBe('Note "Ghost" not found'))
    expect(openNote).not.toHaveBeenCalled()
  })

  it('shows a circular placeholder when a note embeds itself, without fetching', async () => {
    const { container } = mount('![[A]]', '/ws/a.md')

    await waitFor(() => expect(container.textContent).toContain('Circular embed: "A"'))
    expect(openNote).not.toHaveBeenCalled()
  })

  it('stops an A -> B -> A cycle at the second level', async () => {
    contents['/ws/b.md'] = '# B\n\n![[A]]'
    const { container } = mount('![[B]]', '/ws/a.md')

    await waitFor(() => expect(container.textContent).toContain('Circular embed: "A"'))
    expect(openNote).toHaveBeenCalledTimes(1)
  })

  it('stops nesting beyond the depth cap', async () => {
    contents['/ws/n1.md'] = '# N1\n\n![[N2]]'
    contents['/ws/n2.md'] = '# N2\n\n![[N3]]'
    contents['/ws/n3.md'] = '# N3\n\nthird level\n\n![[N4]]'
    contents['/ws/n4.md'] = '# N4\n\nfourth level'
    const { container } = mount('![[N1]]')

    await waitFor(() => expect(container.textContent).toContain('Embed nested too deeply'))
    expect(container.textContent).toContain('third level')
    expect(container.textContent).not.toContain('fourth level')
    expect(openNote).not.toHaveBeenCalledWith('/ws', '/ws/n4.md')
  })

  it('renders the target in a read-only editor', async () => {
    contents['/ws/b.md'] = '# B\nhello world'
    const { container } = mount('![[B]]')

    await waitFor(() => expect(container.querySelector('.note-embed-body .tiptap')).toBeInTheDocument())
    expect(container.querySelector('.note-embed-body .tiptap')?.getAttribute('contenteditable')).toBe('false')
  })

  it('follows the source when it changes on disk', async () => {
    contents['/ws/b.md'] = '# B\nfirst version'
    const { container } = mount('![[B]]')
    await waitFor(() => expect(container.querySelector('.note-embed-body')?.textContent).toContain('first version'))

    contents['/ws/b.md'] = '# B\nsecond version'
    await act(async () => {
      for (const handler of changeHandlers) await handler({ payload: ['/ws/b.md'] })
    })

    await waitFor(() => expect(container.querySelector('.note-embed-body')?.textContent).toContain('second version'))
    expect(markdownOf()).toBe('![[B]]')
  })
})
