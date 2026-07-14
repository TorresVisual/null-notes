export interface NoteMetadata {
  id: string
  title: string
  path: string
  workspace: string
  updatedAt: number
}

export interface SearchResult {
  path: string
  title: string
  snippet: string
}

export interface WorkspaceState {
  openTabs: string[]
  activeTab: string | null
}
