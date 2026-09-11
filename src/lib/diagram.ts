import { invoke } from '@tauri-apps/api/core'
import { useWorkspaceStore } from '../store/workspace'
import type { DiagramMetadata } from '../types'

export const diagramApi = {
  ensureDir: (notePath: string) => invoke<string>('ensure_diagrams_dir', { notePath }),

  list: (workspace: string) => invoke<DiagramMetadata[]>('list_diagrams', { workspace }),

  read: (path: string) => invoke<string>('read_diagram', { path }),

  write: async (path: string, content: string): Promise<void> => {
    await invoke<void>('write_diagram', { path, content })
    // Same gap as ink.ts's write: a .diagrams file written directly never
    // reaches the auto-commit pending list otherwise.
    useWorkspaceStore.getState().addGitPendingPath(path)
  },
}
