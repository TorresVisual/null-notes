export interface NoteMetadata {
  id: string
  title: string
  path: string
  workspace: string
  updatedAt: number
}

export interface WorkspaceState {
  openTabs: string[]
  activeTab: string | null
}
