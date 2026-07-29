import { invoke } from '@tauri-apps/api/core'
import type { NoteMetadata, WorkspaceState, WorkspaceTree, SearchResult, AppSettings, GraphLink, GraphTag } from '../types'
import type { PdfPage } from '../pdf/types'

export const api = {
  notes: {
    list: (workspace: string) =>
      invoke<NoteMetadata[]>('list_notes', { workspace }),
    scan: (workspace: string) =>
      invoke<WorkspaceTree>('scan_workspace', { workspace }),
    open: (path: string) =>
      invoke<string>('open_note', { path }),
    save: (path: string, content: string) =>
      invoke<void>('save_note', { path, content }),
    reindex: (path: string, workspace: string, content: string) =>
      invoke<void>('reindex_note', { path, workspace, content }),
    reindexFromDisk: (path: string, workspace: string) =>
      invoke<boolean>('reindex_from_disk', { path, workspace }),
    create: (workspace: string, folder: string, title: string) =>
      invoke<NoteMetadata>('create_note', { workspace, folder, title }),
    rename: (path: string, newTitle: string, workspace: string) =>
      invoke<NoteMetadata>('rename_note', { path, newTitle, workspace }),
    delete: (path: string) =>
      invoke<void>('delete_note', { path }),
    search: (query: string) =>
      invoke<SearchResult[]>('search_notes', { query }),
    listTags: (workspace: string) =>
      invoke<string[]>('list_tags', { workspace }),
    notesWithTag: (workspace: string, tag: string) =>
      invoke<NoteMetadata[]>('notes_with_tag', { workspace, tag }),
    backlinksFor: (workspace: string, title: string) =>
      invoke<NoteMetadata[]>('backlinks_for', { workspace, title }),
    createFolder: (parent: string, name: string) =>
      invoke<string>('create_folder', { parent, name }),
    renameFolder: (oldPath: string, newPath: string) =>
      invoke<void>('rename_folder', { oldPath, newPath }),
    deleteFolder: (path: string) =>
      invoke<void>('delete_folder', { path }),
    moveNote: (path: string, destFolder: string) =>
      invoke<string>('move_note', { path, destFolder }),
    graphLinks: (workspace: string) =>
      invoke<GraphLink[]>('graph_links', { workspace }),
    graphTags: (workspace: string) =>
      invoke<GraphTag[]>('graph_tags', { workspace }),
  },
  window: {
    confirmClose: () => invoke<void>('confirm_close'),
  },
  workspace: {
    watch: (workspace: string) =>
      invoke<void>('watch_workspace', { workspace }),
    load: (path: string) =>
      invoke<WorkspaceState>('load_workspace', { path }),
    save: (path: string, state: WorkspaceState) =>
      invoke<void>('save_workspace', { path, state }),
    recents: () =>
      invoke<string[]>('recent_workspaces'),
    remember: (path: string) =>
      invoke<string[]>('remember_workspace', { path }),
  },
  settings: {
    load: () =>
      invoke<AppSettings>('load_settings'),
    save: (settings: AppSettings) =>
      invoke<void>('save_settings', { settings }),
  },
  pdf: {
    ensureDir: (notePath: string) =>
      invoke<string>('ensure_pdf_dir', { notePath }),
    importPages: (pdfPath: string, notePath: string) =>
      invoke<PdfPage[]>('import_pdf_pages', { pdfPath, notePath }),
    readPage: (path: string) =>
      invoke<string>('read_pdf_page', { path }),
  },
}
