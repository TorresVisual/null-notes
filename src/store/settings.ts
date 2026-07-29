import { create } from 'zustand'
import type { AppSettings } from '../types'

export const DEFAULT_SETTINGS: AppSettings = {
  autosaveDebounceMs: 600,
  editorMaxWidthPx: 800,
  spellcheck: false,
}

interface SettingsStore {
  settings: AppSettings
  setSettings: (settings: AppSettings) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  setSettings: (settings) => set({ settings }),
}))
