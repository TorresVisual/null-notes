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

export interface BacklinkEntry {
  note: NoteMetadata
  snippet: string | null
}

export type CodeLinkStatus = 'ok' | 'missing' | 'stale'

export interface CodeLinkTarget {
  target: string
  line: number | null
}

export interface SearchResult {
  path: string
  title: string
  workspace: string
  updatedAt: number
  snippet: string
}

export interface SearchPage {
  results: SearchResult[]
  total: number
}

export type SearchSort = 'relevance' | 'modified' | 'name'

export interface GitWorkspaceConfig {
  /** Whether the one-time "enable auto-commit?" prompt has been answered. */
  prompted: boolean
  autoCommit: boolean
  /** Minutes of no note activity before a pending batch is committed. */
  idleMinutes: number
  /** Per-workspace opt-out of running commit hooks on an auto-commit. */
  skipHooks: boolean
  /** Push after each auto-commit — only consulted when repoMode is 'notesOnly' or 'notesMonorepo'. */
  autoPush: boolean
  /**
   * Explicit per-workspace override for a `codeRepo` workspace: "I've
   * checked this repo and it's fine to auto-push here." Off by default and
   * only ever flipped on through a confirm dialog — `codeRepo` otherwise
   * never auto-pushes, at any setting.
   */
  allowCodeRepoPush: boolean
}

export interface WorkspaceState {
  openTabs: string[]
  activeTab: string | null
  secondaryTab?: string | null
  splitRatio?: number
  sidebarCollapsed?: boolean
  tagsCollapsed?: boolean
  pinnedTabs?: string[]
  expandedFolders: string[]
  recentSearches: string[]
  git: GitWorkspaceConfig
}

/**
 * Which of P5's Git modes a workspace is in, or null when it isn't a Git
 * repository at all. 'notesMonorepo': the workspace is a subtree of a repo,
 * but every directory between it and the repo root holds nothing but
 * sibling note-workspaces — a multi-course repo, not someone else's source,
 * so it gets 'notesOnly'-like auto-push treatment.
 */
export type RepoMode = 'notesOnly' | 'codeRepo' | 'notesMonorepo'

export type GitCommitStatus = 'idle' | 'committing' | 'committed' | 'skipped' | 'error' | 'pushFailed'

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

export type PullOutcome =
  | { kind: 'upToDate' }
  | { kind: 'fastForwarded' }
  | { kind: 'diverged'; ahead: number; behind: number; localPaths: string[]; remotePaths: string[] }
  | { kind: 'ahead'; ahead: number }
  | { kind: 'noRemote' }
  | { kind: 'noUpstream'; ahead: number }
  | { kind: 'blocked'; output: string; paths: string[] }

export type RebaseOutcome =
  | { kind: 'rebased' }
  | { kind: 'aborted'; output: string }

export type RepoInitOutcome =
  | { kind: 'initializedWithRemote' }
  | { kind: 'initializedLocalOnly'; remoteAddCommand: string }

export interface NoteHistoryEntry {
  sha: string
  timestampMs: number
  message: string
  path: string
}

export interface TrashEntry {
  id: string
  workspace: string
  originalPath: string
  isFolder: boolean
  name: string
  trashedAt: number
}

export interface MergeSnapshot {
  path: string
  before: string
  after: string
}

export interface MergeOutcome {
  trash: TrashEntry
  snapshots: MergeSnapshot[]
}

export interface GithubRepo {
  nameWithOwner: string
  url: string
  isPrivate: boolean
}

export type PdfImportMode = 'pages' | 'markdown'

export type CodeIndentChar = 'space' | 'tab'

export type CodeTheme = 'material-ocean' | 'one-dark'

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
  /** Width of one indent level in a code block. Ignored when `codeIndentChar` is `'tab'`. */
  codeIndentWidth: number
  codeIndentChar: CodeIndentChar
  codeTheme: CodeTheme
  /** Independent of the editor's own prose font size. */
  codeFontSizePx: number
  /** Interpreter for `python` code blocks. Empty means "detect on next load." */
  pythonCommand: string
  /** Compiler for `cpp`/`c++`/`c` code blocks. MSVC's `cl.exe` isn't detected. */
  cppCompilerCommand: string
  /** Wall-clock seconds before a running code block is killed automatically. */
  codeRunTimeoutSecs: number
  /** Command id → key combo, only where it differs from the default; `""` means cleared. */
  keymap: Record<string, string>
}

export interface ErrorLogEntry {
  timestamp: string
  source: string
  message: string
  context: string | null
}

export interface GraphLink {
  sourcePath: string
  targetTitle: string
}

export interface GraphTag {
  notePath: string
  tag: string
}

export interface TemplateMetadata {
  name: string
  path: string
}

export interface DiagramMetadata {
  jsonPath: string
  svgPath: string
  noteTitle: string
}

export interface CrossRefTarget {
  calloutType: string
  number: string
}

export interface OpenTask {
  notePath: string
  noteTitle: string
  text: string
  position: number
}

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface DueCard {
  notePath: string
  noteTitle: string
  kind: string
  front: string
  back: string
  position: number
  options: string[]
  streak: number
}

export interface McGradeResult {
  correct: number[]
}

export interface CardSummary {
  notePath: string
  noteTitle: string
  kind: string
  front: string
  back: string
  position: number
  due: string
  interval: number
  streak: number
  lapses: number
  suspended: boolean
  tags: string[]
}

export interface PrinterInfo {
  name: string
  isDefault: boolean
}
