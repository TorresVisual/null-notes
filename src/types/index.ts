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

export interface GitWorkspaceConfig {
  /** Whether the one-time "enable auto-commit?" prompt has been answered. */
  prompted: boolean
  autoCommit: boolean
  /** Minutes of no note activity before a pending batch is committed. */
  idleMinutes: number
  /** Per-workspace opt-out of running commit hooks on an auto-commit. */
  skipHooks: boolean
  /** Push after each auto-commit — only consulted when repoMode is 'notesOnly'. */
  autoPush: boolean
}

export interface WorkspaceState {
  openTabs: string[]
  activeTab: string | null
  expandedFolders: string[]
  git: GitWorkspaceConfig
}

/** Which of P5's two Git modes a workspace is in, or null when it isn't a Git repository at all. */
export type RepoMode = 'notesOnly' | 'codeRepo'

export type GitCommitStatus = 'idle' | 'committing' | 'committed' | 'skipped' | 'error'

export type CommitOutcome =
  | { kind: 'committed' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'nothingToCommit' }
  | { kind: 'hookFailed'; output: string }

export type PushOutcome =
  | { kind: 'pushed' }
  | { kind: 'noRemote' }
  | { kind: 'authFailed'; output: string }
  | { kind: 'rejected'; output: string }

export type PdfImportMode = 'pages' | 'markdown'

export interface AppSettings {
  autosaveDebounceMs: number
  editorMaxWidthPx: number
  spellcheck: boolean
  /** BCP-47 tag; becomes the editor's `lang`, which is what picks the dictionary. */
  spellcheckLanguage: string
  pdfImportMode: PdfImportMode
  /** Launch template for code deep links, with {file} and {line} placeholders. */
  editorCommand: string
  /** Shell a terminal pane spawns, e.g. `powershell` or `wsl -d Ubuntu`. */
  terminalShell: string
}

export interface GraphLink {
  sourcePath: string
  targetTitle: string
}

export interface GraphTag {
  notePath: string
  tag: string
}
