import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'
import { Layout } from './Layout'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settings'
import { useNote } from '../hooks/useNote'
import { api } from '../lib/tauri'
import { platform } from '@tauri-apps/plugin-os'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(vi.fn()),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  message: vi.fn(),
  open: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'windows') }))
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: vi.fn().mockResolvedValue({ unregister: vi.fn() }) }))
// Cannot reference the top-level DEFAULT_SETTINGS import here — vi.mock
// factories are hoisted above imports, so that would be a TDZ access.
// Inlining the same literal values sidesteps it.
vi.mock('../lib/tauri', () => ({
  api: {
    workspace: {
      initialWorkspace: vi.fn().mockResolvedValue(null),
      initialSelectFile: vi.fn().mockResolvedValue(null),
    },
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
      backlinksFor: vi.fn().mockResolvedValue([]),
      backlinksForWithContext: vi.fn().mockResolvedValue([]),
      unlinkedMentionsForWithContext: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
    },
    git: {
      listNoteHistory: vi.fn().mockResolvedValue([]),
    },
  },
}))
vi.mock('../hooks/useNote', () => ({
  useNote: vi.fn(() => ({
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
  })),
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
vi.mock('../hooks/useTerminal', () => ({
  useTerminal: () => ({ insertText: vi.fn(), kill: vi.fn(), isReady: true }),
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
  // vi.clearAllMocks() (afterEach, below) clears call history but not a
  // mockReturnValue override from a previous test — without this, a test
  // further down the file that overrides useNote (e.g. isLoading: true)
  // would leak that override into every test that runs after it.
  vi.mocked(useNote).mockReturnValue({
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
  })
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

  it('fires a rebound shortcut and no longer fires the old default', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, keymap: { 'shortcuts-help': 'Ctrl+Alt+J' } } })
    render(<Layout />)

    act(() => pressKey('?'))
    expect(screen.queryByRole('heading', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument()

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, altKey: true, bubbles: true }))
    })
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

  it('scrolls to and highlights the match after selecting a free-text search result (#19)', async () => {
    useWorkspaceStore.setState({ path: '/ws', activeTab: '/ws/Other.md', tagFilter: null })
    useNotesStore.setState({
      notes: [
        { id: '1', path: '/ws/Other.md', title: 'Other', workspace: '/ws', updatedAt: 0 },
        { id: '2', path: '/ws/Target.md', title: 'Target', workspace: '/ws', updatedAt: 0 },
      ],
      folders: [],
      tags: [],
    })
    vi.mocked(useNote).mockImplementation((notePath) => ({
      content: notePath === '/ws/Target.md' ? '# Target\n\nzzneedle marks the spot\n' : '',
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
    }))
    vi.mocked(api.notes.search).mockResolvedValue({
      results: [
        { path: '/ws/Target.md', title: 'Target', workspace: '/ws', updatedAt: 1, snippet: 'zzneedle marks the spot' },
      ],
      total: 1,
    })

    render(<Layout />)
    act(() => runCommand('search'))
    fireEvent.change(screen.getByPlaceholderText(/Search notes/), { target: { value: 'zzneedle' } })

    const result = await waitFor(() => {
      const el = document.querySelector('.search-result-title')
      expect(el).toBeInTheDocument()
      return el!
    })

    fireEvent.click(result)

    await waitFor(() => expect(document.querySelector('.search-jump-target')).toBeInTheDocument())
  })
})

describe('Layout terminal command on mobile', () => {
  it('does not mount the terminal pane on iOS even via the toggle-terminal command', () => {
    vi.mocked(platform).mockReturnValue('ios')
    useWorkspaceStore.setState({ path: '/ws', activeTab: null, tagFilter: null })
    render(<Layout />)

    act(() => runCommand('toggle-terminal'))

    expect(document.querySelector('.terminal-pane')).not.toBeInTheDocument()
  })

  it('still mounts the terminal pane on desktop', async () => {
    vi.mocked(platform).mockReturnValue('windows')
    useWorkspaceStore.setState({ path: '/ws', activeTab: null, tagFilter: null })
    render(<Layout />)

    act(() => runCommand('toggle-terminal'))

    await waitFor(() => expect(document.querySelector('.terminal-pane')).toBeInTheDocument())
  })
})

describe('Layout note-loading indicator', () => {
  it('shows a spinner next to the loading text while a note is loading', () => {
    useWorkspaceStore.setState({ path: '/ws', activeTab: '/ws/Lecture.md', tagFilter: null })
    useNotesStore.setState({
      notes: [{ id: '1', path: '/ws/Lecture.md', title: 'Lecture', workspace: '/ws', updatedAt: 0 }],
      folders: [],
      tags: [],
    })
    vi.mocked(useNote).mockReturnValue({
      content: '',
      save: vi.fn(),
      isLoading: true,
      saveState: 'clean',
      saveError: null,
      flush: vi.fn().mockResolvedValue(undefined),
      retrySave: vi.fn(),
      dismissError: vi.fn(),
      conflict: false,
      keepMine: vi.fn(),
      reloadTheirs: vi.fn(),
    })

    render(<Layout />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(document.querySelector('.spin')).toBeInTheDocument()
  })
})

describe('Layout note history panel', () => {
  it('shows the history panel only when the workspace is a Git repository', () => {
    useWorkspaceStore.setState({
      path: '/ws',
      activeTab: '/ws/Lecture.md',
      tagFilter: null,
      repoMode: null,
    })
    useNotesStore.setState({
      notes: [{ id: '1', path: '/ws/Lecture.md', title: 'Lecture', workspace: '/ws', updatedAt: 0 }],
      folders: [],
      tags: [],
    })

    render(<Layout />)

    expect(screen.queryByText(/History \(/)).not.toBeInTheDocument()
  })

  it('shows the history panel when the workspace is a Git repository', async () => {
    useWorkspaceStore.setState({
      path: '/ws',
      activeTab: '/ws/Lecture.md',
      tagFilter: null,
      repoMode: 'notesOnly',
    })
    useNotesStore.setState({
      notes: [{ id: '1', path: '/ws/Lecture.md', title: 'Lecture', workspace: '/ws', updatedAt: 0 }],
      folders: [],
      tags: [],
    })

    render(<Layout />)

    expect(await screen.findByText(/History \(/)).toBeInTheDocument()
  })
})

describe('Layout split-pane rendering', () => {
  it('renders two note editors side by side when secondaryTab is set', () => {
    useWorkspaceStore.setState({
      path: '/ws',
      activeTab: '/ws/a.md',
      secondaryTab: '/ws/b.md',
      splitRatio: 0.5,
      tagFilter: null,
    })
    useNotesStore.setState({
      notes: [
        { id: '1', path: '/ws/a.md', title: 'a', workspace: '/ws', updatedAt: 0 },
        { id: '2', path: '/ws/b.md', title: 'b', workspace: '/ws', updatedAt: 0 },
      ],
      folders: [],
      tags: [],
    })

    render(<Layout />)

    expect(document.querySelectorAll('.pane-wrapper')).toHaveLength(2)
    expect(document.querySelector('.pane-divider')).toBeInTheDocument()
  })

  it('closing the secondary pane collapses back to a single pane', () => {
    useWorkspaceStore.setState({
      path: '/ws',
      activeTab: '/ws/a.md',
      secondaryTab: '/ws/b.md',
      splitRatio: 0.5,
      tagFilter: null,
    })
    useNotesStore.setState({
      notes: [
        { id: '1', path: '/ws/a.md', title: 'a', workspace: '/ws', updatedAt: 0 },
        { id: '2', path: '/ws/b.md', title: 'b', workspace: '/ws', updatedAt: 0 },
      ],
      folders: [],
      tags: [],
    })

    render(<Layout />)
    fireEvent.click(screen.getByLabelText('Close split pane'))

    expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
    expect(document.querySelectorAll('.pane-wrapper')).toHaveLength(1)
  })
})

describe('Layout on a phone', () => {
  it('renders the phone shell instead of the desktop chrome on mobile', () => {
    vi.mocked(platform).mockReturnValue('android')
    useWorkspaceStore.setState({ path: '/ws', activeTab: null, tagFilter: null })
    const { container } = render(<Layout />)
    expect(container.querySelector('.mobile-shell')).not.toBeNull()
    expect(container.querySelector('.titlebar')).toBeNull()
    expect(container.querySelector('aside.sidebar')).toBeNull()
    vi.mocked(platform).mockReturnValue('windows')
  })
})
