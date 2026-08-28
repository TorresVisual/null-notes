import { create } from 'zustand'
import type { AppSettings } from '../types'

export const DEFAULT_SETTINGS: AppSettings = {
  autosaveDebounceMs: 600,
  editorMaxWidthPx: 800,
  spellcheck: false,
  spellcheckLanguage: 'de',
  pdfImportMode: 'pages',
  editorCommand: 'code -g {file}:{line}',
  terminalShell: 'powershell',
  codeIndentWidth: 2,
  codeIndentChar: 'space',
  codeTheme: 'material-ocean',
  codeFontSizePx: 13,
  pythonCommand: 'python3',
  cppCompilerCommand: 'g++',
  codeRunTimeoutSecs: 10,
}

interface SettingsStore {
  settings: AppSettings
  setSettings: (settings: AppSettings) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  setSettings: (settings) => set({ settings }),
}))
