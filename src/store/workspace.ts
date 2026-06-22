import { create } from 'zustand'

interface WorkspaceStore {
  path: string | null
  openTabs: string[]
  activeTab: string | null
  setPath: (path: string) => void
  openTab: (notePath: string) => void
  closeTab: (notePath: string) => void
  setActiveTab: (notePath: string) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  path: null,
  openTabs: [],
  activeTab: null,

  setPath: (path) => set({ path }),

  openTab: (notePath) => {
    const { openTabs } = get()
    if (openTabs.includes(notePath)) {
      set({ activeTab: notePath })
      return
    }
    set({ openTabs: [...openTabs, notePath], activeTab: notePath })
  },

  closeTab: (notePath) => {
    const { openTabs, activeTab } = get()
    const next = openTabs.filter((p) => p !== notePath)
    const newActive =
      activeTab === notePath ? (next[next.length - 1] ?? null) : activeTab
    set({ openTabs: next, activeTab: newActive })
  },

  setActiveTab: (notePath) => set({ activeTab: notePath }),
}))
