import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import { Editor } from '@tiptap/core'
import { coreExtensions, extensionsFor } from './index'
import { handleEditorTextInput } from './CodeBlockEditor'
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
    // The app's own editorProps: they auto-close brackets and step over a typed
    // closer, which is what real typing goes through before any input rule.
    const instance = new Editor({
      extensions: extensionsFor(NOTE),
      content,
      editorProps: { handleTextInput: handleEditorTextInput },
    })
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

describe('NoteLink suggestions', () => {
  it('offers notes after [text]( and writes a relative link on selection', async () => {
    const user = userEvent.setup()
    useNotesStore.setState({
      notes: [
        { path: `${WS}\\A.md`, title: 'A', workspace: WS },
        { path: LINK_PATH, title: 'Link', workspace: WS },
        { path: `${WS}\\sub\\Other.md`, title: 'Other', workspace: WS },
      ] as never,
    })
    let current: Editor | null = null
    function Mounted() {
      const instance = useEditor({
        extensions: extensionsFor(`${WS}\\A.md`),
        content: '<p></p>',
        editorProps: { handleTextInput: handleEditorTextInput },
      })
      current = instance
      return <EditorContent editor={instance} />
    }
    const { container } = render(<Mounted />)
    await waitFor(() => expect(current).not.toBeNull())

    ;(current as Editor | null)?.commands.focus('end')
    // userEvent.type treats "[" as a special key; "[[" types a literal "[".
    await user.type(container.querySelector('.tiptap') as HTMLElement, '[[See Results](Li')

    const item = await waitFor(() => {
      const els = document.querySelectorAll('.slash-menu-item')
      if (els.length !== 1) throw new Error(`expected one suggestion, got ${els.length}`)
      return els[0] as Element
    })
    expect(item.textContent).toBe('Link')

    await user.click(item)
    await waitFor(() => expect(markdownOf(current as unknown as Editor)).toBe('[See Results](Link.md)'))
  })
})

describe('PlainText brackets', () => {
  const saved = (text: string) => {
    const instance = new Editor({
      extensions: extensionsFor(`${WS}\\A.md`),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    })
    return markdownOf(instance)
  }

  it('saves a lone bracket pair without backslashes', () => {
    expect(saved('[ results ]')).toBe('[ results ]')
  })

  it('keeps the escape where bare brackets would re-parse as a link or checkbox', () => {
    expect(saved('[x](y)')).toBe('\\[x\\](y)')
    expect(saved('[ ] todo')).toBe('\\[ \\] todo')
  })
})

describe('LinkSource', () => {
  const NOTE = `${WS}A.md`

  function focused(content: string) {
    const instance = new Editor({ extensions: extensionsFor(NOTE), content })
    instance.view.dom.dispatchEvent(new Event('focus'))
    return instance
  }

  it('shows the Markdown source while the caret is on the line, and saves it unchanged', () => {
    const instance = focused('<p>go <a href="Link.md">Link</a> now</p><p>other</p>')
    instance.commands.setTextSelection(2)
    expect(instance.getText()).toContain('go [Link](Link.md) now')
    expect(instance.getHTML()).not.toContain('<a ')
    expect(markdownOf(instance)).toBe('go [Link](Link.md) now\n\nother')
  })

  it('turns an edited destination back into a link when the caret leaves the line', () => {
    const instance = focused('<p>go <a href="Link.md">Link</a> now</p><p>other</p>')
    instance.commands.setTextSelection(2)
    const text = instance.state.doc.textContent
    const at = 1 + text.indexOf('Link.md)') + 'Link'.length
    instance.view.dispatch(instance.state.tr.insertText('2', at))
    instance.commands.setTextSelection(instance.state.doc.content.size - 2)
    expect(instance.getHTML()).toContain('href="Link2.md"')
  })

  it('collapses on blur', () => {
    const instance = focused('<p><a href="Link.md">Link</a></p>')
    instance.commands.setTextSelection(1)
    expect(instance.getHTML()).not.toContain('<a ')
    instance.view.dom.dispatchEvent(new Event('blur'))
    expect(instance.getHTML()).toContain('href="Link.md"')
  })

  it('breaks the line after the source when Enter is pressed inside it', () => {
    const instance = focused('<p><a href="Link.md">Text</a></p>')
    instance.commands.setTextSelection(3)
    instance.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(instance.state.doc.childCount).toBe(2)
    expect(instance.state.doc.child(0).textContent).toBe('Text')
    expect(instance.getHTML()).toContain('href="Link.md"')
  })

  it('lets Enter break the line while the ](…) menu is open with no matches', async () => {
    function Source() {
      const instance = useEditor({ extensions: extensionsFor(NOTE), content: '<p><a href="Link.md">Text</a>d</p>' })
      return <EditorContent editor={instance} />
    }
    const { container } = render(<Source />)
    const pm = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.ProseMirror')
      if (!el) throw new Error('editor not mounted')
      return el
    })
    const editor = (pm as unknown as { editor: Editor }).editor
    pm.focus()
    editor.commands.setTextSelection(16)
    await waitFor(() => expect(editor.getText()).toContain('[Text](Link.md)d'))
    await userEvent.keyboard('{Enter}')
    expect(editor.state.doc.childCount).toBe(2)
  })
})
