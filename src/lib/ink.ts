import { invoke } from '@tauri-apps/api/core'
import type { InkData } from '../ink/types'
import { inkDataToSvg, svgToInkData } from '../ink/svgSerialiser'

export const inkApi = {
  ensureDir: (notePath: string) =>
    invoke<string>('ensure_ink_dir', { notePath }),

  read: async (path: string): Promise<InkData | null> => {
    try {
      const svg = await invoke<string>('read_ink', { path })
      return svgToInkData(svg)
    } catch {
      return null
    }
  },

  write: async (path: string, data: InkData): Promise<void> => {
    const svg = inkDataToSvg(data)
    await invoke<void>('write_ink', { path, svg })
  },
}
