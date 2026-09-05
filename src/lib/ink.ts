import { invoke } from '@tauri-apps/api/core'
import type { InkData } from '../ink/types'
import { inkDataToSvg, svgToInkData } from '../ink/svgSerialiser'
import { useWorkspaceStore } from '../store/workspace'

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
    // Otherwise a stroke drawn straight to the .ink sidecar never enters the
    // auto-commit's pathspec-scoped pending list — only note.md saves did.
    useWorkspaceStore.getState().addGitPendingPath(path)
  },
}
