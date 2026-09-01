import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { NoteEditor } from './NoteEditor'
import { RawEditor } from './RawEditor'

afterEach(cleanup)

function editorRoot(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.ProseMirror')
  if (!el) throw new Error('editor not mounted')
  return el as HTMLElement
}

// The WebView picks its dictionary from `lang`, and nothing else. Without one
// the note inherits index.html's `lang="en"`, so German prose is checked
// against English and comes back underlined word for word — which reads as
// spellcheck being broken rather than as being pointed at the wrong language.
describe('the editor tells the WebView which dictionary to use', () => {
  it('puts the configured language on the rich editor', async () => {
    const { container } = render(
      <NoteEditor
        content="Rechtschreibung"
        notePath="/ws/a.md"
        spellcheck
        spellcheckLanguage="de"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )

    await waitFor(() => expect(editorRoot(container).getAttribute('lang')).toBe('de'))
    expect(editorRoot(container).getAttribute('spellcheck')).toBe('true')
  })

  // ProseMirror re-applies editorProps.attributes on every state update, so a
  // changed setting has to go through setOptions to survive the next keystroke.
  it('follows the setting when it changes, without remounting', async () => {
    const { container, rerender } = render(
      <NoteEditor
        content="Rechtschreibung"
        notePath="/ws/a.md"
        spellcheck
        spellcheckLanguage="de"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )
    await waitFor(() => expect(editorRoot(container).getAttribute('lang')).toBe('de'))
    const before = editorRoot(container)

    rerender(
      <NoteEditor
        content="Rechtschreibung"
        notePath="/ws/a.md"
        spellcheck
        spellcheckLanguage="en-GB"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )

    await waitFor(() => expect(editorRoot(container).getAttribute('lang')).toBe('en-GB'))
    expect(editorRoot(container)).toBe(before)
  })

  it('puts it on the raw markdown editor too', () => {
    const { container } = render(
      <RawEditor content="Rechtschreibung" spellcheck spellcheckLanguage="de" onChange={() => {}} />,
    )

    const textarea = container.querySelector('textarea')
    expect(textarea?.getAttribute('lang')).toBe('de')
    expect(textarea?.getAttribute('spellcheck')).toBe('true')
  })
})
