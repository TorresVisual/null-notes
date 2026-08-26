import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { NoteEditor } from './NoteEditor'
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settings'

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

describe('NoteEditor code-block theme/font-size wiring (P11-4)', () => {
  it('sets data-code-theme from the settings store, defaulting to material-ocean', () => {
    const { container } = render(
      <NoteEditor content="" notePath="/note.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} />,
    )
    expect(container.querySelector('.note-editor')?.getAttribute('data-code-theme')).toBe('material-ocean')
  })

  it('reflects a non-default codeTheme setting', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeTheme: 'one-dark' } }))

    const { container } = render(
      <NoteEditor content="" notePath="/note.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} />,
    )

    expect(container.querySelector('.note-editor')?.getAttribute('data-code-theme')).toBe('one-dark')
  })

  it('sets --code-font-size from codeFontSizePx, independent of prose settings', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeFontSizePx: 18 } }))

    const { container } = render(
      <NoteEditor content="" notePath="/note.md" spellcheck={false} spellcheckLanguage="en" onChange={() => {}} />,
    )

    const el = container.querySelector('.note-editor') as HTMLElement
    expect(el.style.getPropertyValue('--code-font-size')).toBe('18px')
  })
})
