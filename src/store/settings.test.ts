import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore, DEFAULT_SETTINGS } from './settings'

describe('useSettingsStore', () => {
  beforeEach(() => useSettingsStore.setState({ settings: DEFAULT_SETTINGS }))

  it('starts with the default settings', () => {
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('replaces the settings wholesale', () => {
    useSettingsStore.getState().setSettings({
      autosaveDebounceMs: 1200,
      editorMaxWidthPx: 960,
      spellcheck: true,
      spellcheckLanguage: 'en',
      pdfImportMode: 'markdown',
      editorCommand: 'nvim +{line} {file}',
      terminalShell: 'wsl -d Ubuntu',
      codeIndentWidth: 4,
      codeIndentChar: 'tab',
      codeTheme: 'one-dark',
      codeFontSizePx: 16,
      pythonCommand: 'python3.11',
      cppCompilerCommand: 'clang++',
      codeRunTimeoutSecs: 30,
    })
    expect(useSettingsStore.getState().settings).toEqual({
      autosaveDebounceMs: 1200,
      editorMaxWidthPx: 960,
      spellcheck: true,
      spellcheckLanguage: 'en',
      pdfImportMode: 'markdown',
      editorCommand: 'nvim +{line} {file}',
      terminalShell: 'wsl -d Ubuntu',
      codeIndentWidth: 4,
      codeIndentChar: 'tab',
      codeTheme: 'one-dark',
      codeFontSizePx: 16,
      pythonCommand: 'python3.11',
      cppCompilerCommand: 'clang++',
      codeRunTimeoutSecs: 30,
    })
  })
})
