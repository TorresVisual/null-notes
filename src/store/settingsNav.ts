import { create } from 'zustand'

export type SectionId = 'editor' | 'writing' | 'tools' | 'flashcards' | 'advanced' | 'shortcuts' | 'git' | 'about'

interface SettingsNavState {
  section: SectionId | null
  setSection: (section: SectionId | null) => void
}

export const useSettingsNavStore = create<SettingsNavState>((set) => ({
  section: null,
  setSection: (section) => set({ section }),
}))
