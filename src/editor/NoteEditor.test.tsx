import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { NoteEditor } from './NoteEditor'
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settings'

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

describe('NoteEditor code-block theme/font-size wiring (P11-4)', () => {
  it('sets data-code-theme from the settings store, defaulting to material-ocean', () => {
    const { container } = render(
      <NoteEditor
        content=""
        notePath="/note.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )
    expect(container.querySelector('.note-editor')?.getAttribute('data-code-theme')).toBe('material-ocean')
  })

  it('reflects a non-default codeTheme setting', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeTheme: 'one-dark' } }))

    const { container } = render(
      <NoteEditor
        content=""
        notePath="/note.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )

    expect(container.querySelector('.note-editor')?.getAttribute('data-code-theme')).toBe('one-dark')
  })

  it('sets --code-font-size from codeFontSizePx, independent of prose settings', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeFontSizePx: 18 } }))

    const { container } = render(
      <NoteEditor
        content=""
        notePath="/note.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )

    const el = container.querySelector('.note-editor') as HTMLElement
    expect(el.style.getPropertyValue('--code-font-size')).toBe('18px')
  })
})

describe('NoteEditor tab switch (#14)', () => {
  it('does not flushSync a wiki-link node view mount from inside the content-sync effect', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rerender, container } = render(
      <NoteEditor
        content=""
        notePath="/note-a.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )

    // Switching tabs changes `content` (and `notePath`) in one commit, the
    // same shape as the real TabBar — this is what used to fire the effect's
    // setContent() synchronously inside React's passive-effect flush.
    rerender(
      <NoteEditor
        content='<p><span data-type="wiki-link" data-title="Missing Note"></span></p>'
        notePath="/note-b.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )

    await waitFor(() => expect(container.querySelector('.wiki-link-missing')).toBeInTheDocument())

    const flushSyncWarning = errorSpy.mock.calls.find((call) =>
      String(call[0]).includes('flushSync was called from inside a lifecycle method'),
    )
    expect(flushSyncWarning).toBeUndefined()

    errorSpy.mockRestore()
  })
})
