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
    })
    expect(useSettingsStore.getState().settings).toEqual({
      autosaveDebounceMs: 1200,
      editorMaxWidthPx: 960,
      spellcheck: true,
    })
  })
})
