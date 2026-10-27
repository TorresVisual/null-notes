import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import { Editor } from '@tiptap/core'
import { coreExtensions, extensionsFor } from './index'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('../../lib/tauri', () => ({ api: { notes: { open: vi.fn() } } }))

const { openUrl } = await import('@tauri-apps/plugin-opener')

const WS = 'C:\\ws'
const LINK_PATH = `${WS}\\Link.md`

function TestEditor({ content }: { content: string }) {
  const instance = useEditor({ extensions: coreExtensions, content })
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
  it('keeps [text](Link.md) as one link and opens the note on click', async () => {
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

function typeInto(instance: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = instance.state.selection
    const handled = instance.view.someProp('handleTextInput', (f) => f(instance.view, from, to, ch, () => instance.state.tr.insertText(ch, from, to)))
    if (!handled) instance.view.dispatch(instance.state.tr.insertText(ch, from, to))
  }
}

function markdownOf(instance: Editor): string {
  return (instance.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
}

describe('NoteLink typing', () => {
  const NOTE = `${WS}\\A.md`

  function typing(text: string, content = '<p></p>') {
    const instance = new Editor({ extensions: extensionsFor(NOTE), content })
    typeInto(instance, text)
    return instance
  }

  it('turns typed [text](Link.md) into one link and saves it unescaped', () => {
    const instance = typing('[See Results](Link.md) after')
    expect(instance.getHTML()).toContain('href="Link.md">See Results</a> after')
    expect(markdownOf(instance)).toBe('[See Results](Link.md) after')
  })

  it('does not autolink bare Link.md as a web address', () => {
    expect(typing('Nope.md ').getHTML()).not.toContain('<a ')
  })

  it('links a typed note name when that note sits next to this one', () => {
    const instance = typing('see Link.md and')
    expect(instance.getHTML()).toContain('<a ')
    expect(markdownOf(instance)).toBe('see [Link.md](Link.md) and')
  })

  it('escapes a space in the destination and reads it back as the same link', () => {
    const instance = typing('[Seven](Lecture 7.md)')
    expect(markdownOf(instance)).toBe('[Seven](Lecture%207.md)')
    const reloaded = new Editor({ extensions: extensionsFor(NOTE), content: markdownOf(instance) })
    expect(markdownOf(reloaded)).toBe('[Seven](Lecture%207.md)')
  })

  it('leaves image syntax alone', () => {
    expect(typing('![alt](pic.png)').getHTML()).not.toContain('<a ')
  })
})
