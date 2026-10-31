import { create } from 'zustand'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { api } from '../lib/tauri'
import { isMobile, isWeb } from '../lib/platform'

export type UpdateCheckResult = 'available' | 'current' | 'unsupported' | 'error'

interface UpdateStore {
  update: Update | null
  dialogOpen: boolean
  checking: boolean
  checkForUpdate: (opts?: { openIfFound?: boolean }) => Promise<UpdateCheckResult>
  openDialog: () => void
  closeDialog: () => void
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  update: null,
  dialogOpen: false,
  checking: false,
  checkForUpdate: async ({ openIfFound = true } = {}) => {
    if (isWeb() || isMobile()) return 'unsupported'
    if (get().checking) return 'error'
    set({ checking: true })
    try {
      if (!(await api.window.isReleaseBuild())) return 'unsupported'
      const update = await check()
      set({ update, dialogOpen: update !== null && openIfFound })
      return update ? 'available' : 'current'
    } catch {
      return 'error'
    } finally {
      set({ checking: false })
    }
  },
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}))
