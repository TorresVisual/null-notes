import { create } from 'zustand'

interface MobileEditStore {
  editingPath: string | null
  startEditing: (path: string) => void
  stopEditing: () => void
}

export const useMobileEditStore = create<MobileEditStore>((set) => ({
  editingPath: null,
  startEditing: (path) => set({ editingPath: path }),
  stopEditing: () => set({ editingPath: null }),
}))
