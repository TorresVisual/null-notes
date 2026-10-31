import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'
import { useNotesStore } from '../../store/notes'
import { TooltipProvider } from '../../components/ui/tooltip'

vi.mock('../../lib/tauri', () => ({
  api: { notes: { open: vi.fn() } },
}))

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

function markdownOf(): string | undefined {
  return (editor?.storage as unknown as { markdown: { getMarkdown(): string } } | undefined)?.markdown.getMarkdown()
}

beforeEach(() => {
  useNotesStore.setState({ notes: [] })
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
