export interface NoteMetadata {
  id: string
  title: string
  path: string
  workspace: string
  updatedAt: number
}

export interface WorkspaceTree {
  notes: NoteMetadata[]
  folders: string[]
}

export interface SearchResult {
  path: string
  title: string
  snippet: string
}

export interface WorkspaceState {
  openTabs: string[]
  activeTab: string | null
  expandedFolders: string[]
}

export type PdfImportMode = 'pages' | 'markdown'

export interface AppSettings {
  autosaveDebounceMs: number
  editorMaxWidthPx: number
  spellcheck: boolean
  /** BCP-47 tag; becomes the editor's `lang`, which is what picks the dictionary. */
  spellcheckLanguage: string
  pdfImportMode: PdfImportMode
}

export interface GraphLink {
  sourcePath: string
  targetTitle: string
}

export interface GraphTag {
  notePath: string
  tag: string
}
