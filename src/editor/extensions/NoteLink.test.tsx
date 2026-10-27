import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('../../lib/tauri', () => ({ api: { notes: { open: vi.fn() } } }))

const { openUrl } = await import('@tauri-apps/plugin-opener')

const WS = 'C:\\ws'
const LINK_PATH = `${WS}\\Link.md`

let editor: Editor | null = null

function TestEditor({ content }: { content: string }) {
  const instance = useEditor({ extensions: coreExtensions, content })
  useEffect(() => {
    if (instance) editor = instance
  }, [instance])
  return <EditorContent editor={instance} />
}

beforeEach(() => {
  vi.mocked(openUrl).mockClear()
  useWorkspaceStore.setState({ path: WS, openTabs: [], activeTab: null })
  useNotesStore.setState({
    notes: [{ path: LINK_PATH, title: 'Link', workspace: WS }] as never,
  })
})

describe('NoteLink', () => {
  it('does not autolink a bare .md name typed into prose', async () => {
    render(<TestEditor content="" />)
    await waitFor(() => expect(editor).not.toBeNull())
    editor?.commands.insertContent('See Link.md ')
    expect(editor?.getHTML()).not.toContain('<a ')
  })

  it('keeps [text](Link.md) as one link and opens the note on click', async () => {
    editor = null
    const { container } = render(<TestEditor content="[See Results](Link.md)" />)
    await waitFor(() => expect(container.querySelector('a[href="Link.md"]')).not.toBeNull())
    await userEvent.click(container.querySelector('a[href="Link.md"]') as Element)
    expect(useWorkspaceStore.getState().activeTab).toBe(LINK_PATH)
  })

  it('opens web links in the system browser', async () => {
    const { container } = render(<TestEditor content="[x](https://example.com)" />)
    await waitFor(() => expect(container.querySelector('a')).not.toBeNull())
    await userEvent.click(container.querySelector('a') as Element)
    expect(openUrl).toHaveBeenCalledWith('https://example.com')
  })
})
