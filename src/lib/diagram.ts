import { invoke } from '@tauri-apps/api/core'

export const diagramApi = {
  ensureDir: (notePath: string) => invoke<string>('ensure_diagrams_dir', { notePath }),

  read: (path: string) => invoke<string>('read_diagram', { path }),

  write: (path: string, content: string) => invoke<void>('write_diagram', { path, content }),
}
