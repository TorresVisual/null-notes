import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { Layout } from './Layout'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settings'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  message: vi.fn(),
  open: vi.fn(),
}))
// Cannot reference the top-level DEFAULT_SETTINGS import here — vi.mock
// factories are hoisted above imports, so that would be a TDZ access.
// Inlining the same literal values sidesteps it.
vi.mock('../lib/tauri', () => ({
  api: {
    workspace: { initialWorkspace: vi.fn().mockResolvedValue(null) },
    settings: {
      load: vi.fn().mockResolvedValue({
        autosaveDebounceMs: 600,
        editorMaxWidthPx: 800,
        spellcheck: false,
        spellcheckLanguage: 'de',
        pdfImportMode: 'pages',
        editorCommand: 'code -g {file}:{line}',
        terminalShell: 'powershell',
      }),
    },
    terminal: { close: vi.fn().mockResolvedValue(undefined) },
    window: { confirmClose: vi.fn().mockResolvedValue(undefined) },
    notes: {
      notesWithTag: vi.fn().mockResolvedValue([]),
      listOpenTasks: vi.fn().mockResolvedValue([]),
      listDueCards: vi.fn().mockResolvedValue([]),
    },
  },
}))
vi.mock('../hooks/useNote', () => ({
  useNote: () => ({
    content: '',
    save: vi.fn(),
    isLoading: false,
    saveState: 'clean',
    saveError: null,
    flush: vi.fn().mockResolvedValue(undefined),
    retrySave: vi.fn(),
    dismissError: vi.fn(),
    conflict: false,
    keepMine: vi.fn(),
    reloadTheirs: vi.fn(),
  }),
}))
vi.mock('../hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    saveSession: vi.fn().mockResolvedValue(undefined),
    openWorkspace: vi.fn(),
    openWorkspaceAt: vi.fn().mockResolvedValue(undefined),
  }),
  refreshTags: vi.fn().mockResolvedValue(undefined),
  refreshRecents: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../hooks/useExternalChanges', () => ({ useExternalChanges: () => {} }))
vi.mock('../hooks/useCreateNote', () => ({ useCreateNote: () => vi.fn() }))
vi.mock('../hooks/useCreateFolder', () => ({ useCreateFolder: () => vi.fn() }))
vi.mock('../hooks/useCreateCanvasNote', () => ({ useCreateCanvasNote: () => vi.fn() }))
vi.mock('../hooks/useScrollRestoration', () => ({ useScrollRestoration: () => ({ current: null }) }))
vi.mock('../hooks/useGitConfig', () => ({ useGitConfig: () => ({ updateGit: vi.fn() }) }))
vi.mock('../hooks/useGitAutoCommit', () => ({
  useGitAutoCommit: () => ({ flushGitCommit: vi.fn().mockResolvedValue(undefined) }),
}))

function runCommand(id: string) {
  ;(window as unknown as { __e2eRunCommand: (id: string) => void }).__e2eRunCommand(id)
}

function pressKey(key: string) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

beforeEach(() => {
  useWorkspaceStore.setState({ path: null, activeTab: null, tagFilter: null })
  useNotesStore.setState({ notes: [], folders: [], tags: [] })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Layout overlay exclusivity', () => {
  it('opening Settings then pressing ? replaces it with Shortcuts, not stacks on top', () => {
    render(<Layout />)

    act(() => runCommand('settings'))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    act(() => pressKey('?'))

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
  })

  it('Escape closes Settings', () => {
    render(<Layout />)

    act(() => runCommand('settings'))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    act(() => pressKey('Escape'))

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('Escape closes Search, without SearchModal handling it itself', () => {
    render(<Layout />)

    act(() => runCommand('search'))
    expect(screen.getByPlaceholderText(/Search notes/)).toBeInTheDocument()

    act(() => pressKey('Escape'))

    expect(screen.queryByPlaceholderText(/Search notes/)).not.toBeInTheDocument()
  })
})
