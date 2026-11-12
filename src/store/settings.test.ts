import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore, DEFAULT_SETTINGS } from './settings'

describe('useSettingsStore', () => {
  beforeEach(() => useSettingsStore.setState({ settings: DEFAULT_SETTINGS }))

  it('starts with the default settings', () => {
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('allows CLI access by default', () => {
    expect(useSettingsStore.getState().settings.cliAccess).toBe(true)
  })

  it('replaces the settings wholesale', () => {
    useSettingsStore.getState().setSettings({
      autosaveDebounceMs: 1200,
      editorMaxWidthPx: 960,
      spellcheck: true,
      spellcheckLanguage: 'en',
      spellcheckWords: [],
      pdfImportMode: 'markdown',
      editorCommand: 'nvim +{line} {file}',
      terminalShell: 'wsl -d Ubuntu',
      codeIndentWidth: 4,
      codeIndentChar: 'tab',
      codeTheme: 'one-dark',
      codeFontSizePx: 16,
      pythonCommand: 'python3.11',
      cppCompilerCommand: 'clang++',
      keymap: {},
      mapTileUrl: 'https://tiles.example/{z}/{x}/{y}.png',
      codeRunTimeoutSecs: 30,
      cliAccess: false,
      proseFontSizePx: 18,
      proseLineHeight: 1.8,
      uiZoomPct: 125,
      shownDotFolders: ['.null'],
    })
    expect(useSettingsStore.getState().settings).toEqual({
      autosaveDebounceMs: 1200,
      editorMaxWidthPx: 960,
      spellcheck: true,
      spellcheckLanguage: 'en',
      spellcheckWords: [],
      pdfImportMode: 'markdown',
      editorCommand: 'nvim +{line} {file}',
      terminalShell: 'wsl -d Ubuntu',
      codeIndentWidth: 4,
      codeIndentChar: 'tab',
      codeTheme: 'one-dark',
      codeFontSizePx: 16,
      pythonCommand: 'python3.11',
      cppCompilerCommand: 'clang++',
      keymap: {},
      mapTileUrl: 'https://tiles.example/{z}/{x}/{y}.png',
      codeRunTimeoutSecs: 30,
      cliAccess: false,
      proseFontSizePx: 18,
      proseLineHeight: 1.8,
      uiZoomPct: 125,
      shownDotFolders: ['.null'],
    })
  })
})
