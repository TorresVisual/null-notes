import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { NoteEditor } from './NoteEditor'
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settings'
import { rememberPosition } from '../lib/notePositions'
import { confirm } from '@tauri-apps/plugin-dialog'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn().mockResolvedValue(false),
  message: vi.fn().mockResolvedValue(undefined),
}))

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

describe('NoteEditor cursor restore (#31)', () => {
  it('places the cursor at the remembered fraction through the document, not the raw editor coordinate space', async () => {
    // 0.5 through a 10-character paragraph — the doc is
    // `<p>0123456789</p>`, size 12, so the caret should land at doc position
    // 6 (offset 5 inside the text, between "01234" and "56789").
    rememberPosition('/fraction.md', { cursorFraction: 0.5 })

    render(
      <NoteEditor
        content="0123456789"
        notePath="/fraction.md"
        spellcheck={false}
        spellcheckLanguage="en"
        onChange={() => {}}
        onFlashcardCommand={() => {}}
      />,
    )

    await waitFor(() => {
      const selection = window.getSelection()
      expect(selection?.anchorOffset).toBe(5)
    })
  })
})

describe('command:split-tasks focus guard', () => {
  it('only prompts for the focused editor when two are mounted', async () => {
    const { container } = render(
      <>
        <NoteEditor content="Exercise 1" notePath="/ws/a.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} onFlashcardCommand={() => {}} />
        <NoteEditor content="Exercise 2" notePath="/ws/b.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} onFlashcardCommand={() => {}} />
      </>,
    )
    const [firstPm, secondPm] = Array.from(container.querySelectorAll('.ProseMirror'))
    if (!firstPm || !secondPm) throw new Error('expected two mounted editors')
    await waitFor(() => expect(firstPm.textContent).toContain('Exercise 1'))
    ;(secondPm as HTMLElement).focus()

    window.dispatchEvent(new Event('command:split-tasks'))

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  })
})

describe('NoteEditor accessible name', () => {
  it('labels the one editable textbox and leaves the wrapper out of the a11y tree', async () => {
    const { container } = render(
      <NoteEditor content="Hello" notePath="/ws/a.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} onFlashcardCommand={() => {}} />,
    )
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull())

    const textboxes = container.querySelectorAll('[role="textbox"]')
    expect(textboxes).toHaveLength(1)
    expect(textboxes[0]).toHaveAttribute('aria-label', 'Note')
    expect(textboxes[0]).toHaveAttribute('aria-multiline', 'true')
    expect(textboxes[0]).toHaveClass('ProseMirror')
  })
})
