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

// The rich editor draws its own squiggles (Spellcheck extension), so the
// WebView's native checker must stay off or every word is underlined twice.
// `lang` is still set for assistive tech; the raw editor is a plain <textarea>
// and keeps native checking, where `lang` is what picks the dictionary.
describe('the editor language attributes', () => {
  it('puts the configured language on the rich editor and turns native checking off', async () => {
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
    expect(editorRoot(container).getAttribute('spellcheck')).toBe('false')
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
      <RawEditor
        content="Rechtschreibung"
        notePath="Spellcheck.md"
        spellcheck
        spellcheckLanguage="de"
        onChange={() => {}}
      />,
    )

    const textarea = container.querySelector('textarea')
    expect(textarea?.getAttribute('lang')).toBe('de')
    expect(textarea?.getAttribute('spellcheck')).toBe('true')
  })
})
