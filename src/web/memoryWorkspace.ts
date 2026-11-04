import type { AppSettings, NoteMetadata, WorkspaceState, WorkspaceTree } from '../types'

type Command = (args: Record<string, unknown>) => unknown

const WORKSPACE = '/demo'

const DEFAULT_SETTINGS: AppSettings = {
  autosaveDebounceMs: 600,
  editorMaxWidthPx: 800,
  spellcheck: false,
  spellcheckLanguage: 'en-US',
  pdfImportMode: 'pages',
  editorCommand: '',
  terminalShell: '',
  codeIndentWidth: 2,
  codeIndentChar: 'space',
  codeTheme: 'material-ocean',
  codeFontSizePx: 13,
  pythonCommand: '',
  cppCompilerCommand: '',
  codeRunTimeoutSecs: 10,
  keymap: {},
  mapTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  cliAccess: true,
}

const EMPTY_STATE: WorkspaceState = {
  openTabs: [],
  activeTab: null,
  expandedFolders: [],
  recentSearches: [],
  git: { prompted: true, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: false, allowCodeRepoPush: false },
}

const files = new Map<string, string>([
  [`${WORKSPACE}/Welcome.md`, '# Welcome\n\nThis is the in-memory web workspace. See [[Algorithms]].\n'],
  [`${WORKSPACE}/Algorithms.md`, '# Algorithms\n\n- [ ] read chapter 1\n\n$$E = mc^2$$\n'],
])
let settings = DEFAULT_SETTINGS
let state = EMPTY_STATE
let recents: string[] = []

const titleOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')

const metadata = (path: string): NoteMetadata => ({
  id: path,
  title: titleOf(path),
  path,
  workspace: WORKSPACE,
  updatedAt: Date.now(),
})

const tree = (): WorkspaceTree => ({ notes: [...files.keys()].map(metadata), folders: [], canvases: [] })

export const commands: Record<string, Command> = {
  initial_workspace: () => WORKSPACE,
  initial_select_file: () => null,
  initial_single_note: () => false,
  recent_workspaces: () => recents,
  remember_workspace: ({ path }) => (recents = [String(path), ...recents.filter((p) => p !== path)]),
  load_workspace: () => state,
  save_workspace: (args) => void (state = args.state as WorkspaceState),
  load_settings: () => settings,
  save_settings: (args) => void (settings = args.settings as AppSettings),
  scan_workspace: tree,
  list_notes: () => tree().notes,
  open_note: ({ path }) => files.get(String(path)) ?? '',
  save_note: ({ path, content }) => void files.set(String(path), String(content)),
  create_note: ({ folder, title }) => {
    const path = `${folder}/${title}.md`
    files.set(path, `# ${title}\n`)
    return metadata(path)
  },
  delete_note: ({ path }) => void files.delete(String(path)),
  list_tags: () => [],
  detect_repo: () => null,
  detect_prior_automation: () => false,
  list_errors: () => [],
  reindex_note: () => undefined,
  reindex_from_disk: () => false,
  watch_workspace: () => undefined,
  record_error: () => undefined,
  clear_errors: () => undefined,
}
