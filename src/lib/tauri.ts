import { invoke } from '@tauri-apps/api/core'
import type { NoteMetadata, WorkspaceState, SearchResult } from '../types'

export const api = {
  notes: {
    list: (workspace: string) =>
      invoke<NoteMetadata[]>('list_notes', { workspace }),
    scan: (workspace: string) =>
      invoke<NoteMetadata[]>('scan_workspace', { workspace }),
    open: (path: string) =>
      invoke<string>('open_note', { path }),
    save: (path: string, content: string) =>
      invoke<void>('save_note', { path, content }),
    create: (workspace: string, title: string) =>
      invoke<NoteMetadata>('create_note', { workspace, title }),
    delete: (path: string) =>
      invoke<void>('delete_note', { path }),
    search: (query: string) =>
      invoke<SearchResult[]>('search_notes', { query }),
  },
  workspace: {
    load: (path: string) =>
      invoke<WorkspaceState>('load_workspace', { path }),
    save: (path: string, state: WorkspaceState) =>
      invoke<void>('save_workspace', { path, state }),
  },
}
