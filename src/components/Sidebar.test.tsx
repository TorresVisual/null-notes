import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { platform } from '@tauri-apps/plugin-os'
import { Sidebar } from './Sidebar'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { TooltipProvider } from './ui/tooltip'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

vi.mock('../lib/tauri', () => ({
  api: { notes: { notesWithTag: vi.fn().mockResolvedValue([]) } },
}))
vi.mock('../hooks/useWorkspace', () => ({
  useWorkspace: () => ({ openWorkspace: vi.fn() }),
}))
vi.mock('../hooks/useCreateNote', () => ({ useCreateNote: () => vi.fn() }))
vi.mock('../hooks/useCreateFolder', () => ({ useCreateFolder: () => vi.fn() }))
vi.mock('../hooks/useCreateCanvasNote', () => ({ useCreateCanvasNote: () => vi.fn() }))

const props = {
  onSearchOpen: vi.fn(),
  onSettingsOpen: vi.fn(),
  onTemplateOpen: vi.fn(),
  onGraphOpen: vi.fn(),
  onTaskOpen: vi.fn(),
  onReviewOpen: vi.fn(),
  onFormulaSheetOpen: vi.fn(),
  onTerminalToggle: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Sidebar's secondary-action icons are wrapped in shadcn Tooltips, which
// throw outside a TooltipProvider — mirrors the real provider Layout mounts.
function renderSidebar() {
  return render(
    <TooltipProvider>
      <Sidebar {...props} />
    </TooltipProvider>,
  )
}

describe('Sidebar Home button', () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [], folders: [], tags: [] })
  })

  it('is disabled with no workspace open', () => {
    useWorkspaceStore.setState({ path: null, activeTab: null, tagFilter: null })
    renderSidebar()

    expect(screen.getByRole('button', { name: /Home/ })).toBeDisabled()
  })

  // Mirrors the existing Ctrl H menu accelerator (Layout's runCommand,
  // case 'home') — this button is the click-reachable equivalent, not a
  // second, independent implementation of "go home".
  it('returns to the home view when clicked', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ path: '/ws', activeTab: '/ws/Note.md', tagFilter: null })
    renderSidebar()

    await user.click(screen.getByRole('button', { name: /Home/ }))

    expect(useWorkspaceStore.getState().activeTab).toBeNull()
  })
})

describe('Sidebar Open Workspace button', () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [], folders: [], tags: [] })
  })

  it('shows "Opening…" and disables itself while folderLoading is true', () => {
    useWorkspaceStore.setState({ path: null, activeTab: null, tagFilter: null, folderLoading: true })
    renderSidebar()

    expect(screen.getByRole('button', { name: /Opening…/ })).toBeDisabled()
  })
})

describe('Sidebar rail and panel', () => {
  beforeEach(() => {
    vi.mocked(platform).mockReturnValue('windows')
    useNotesStore.setState({ notes: [], folders: [], tags: ['algebra'] })
    useWorkspaceStore.setState({
      path: '/ws',
      activeTab: null,
      tagFilter: null,
      sidebarCollapsed: false,
      tagsCollapsed: false,
    })
  })

  it('collapses the panel from the rail toggle but keeps the rail', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    const toggle = screen.getByRole('button', { name: 'Toggle sidebar' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await user.click(toggle)

    expect(useWorkspaceStore.getState().sidebarCollapsed).toBe(true)
    expect(container.querySelector('aside')).toHaveClass('sidebar--collapsed')
    expect(container.querySelector('.sidebar-panel')).toHaveAttribute('inert')
    expect(container.querySelector('.sidebar-rail')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('rail launchers fire their handlers', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByLabelText('Graph view'))
    await user.click(screen.getByLabelText('Tasks'))

    expect(props.onGraphOpen).toHaveBeenCalled()
    expect(props.onTaskOpen).toHaveBeenCalled()
  })

  it('collapses and expands the Tags section', async () => {
    const user = userEvent.setup()
    renderSidebar()
    expect(screen.getByRole('button', { name: '#algebra' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tags' }))

    expect(useWorkspaceStore.getState().tagsCollapsed).toBe(true)
    expect(screen.queryByRole('button', { name: '#algebra' })).not.toBeInTheDocument()
  })

  it('opens the New menu with every create action', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'New' }))

    for (const name of ['Note', 'Folder', 'Canvas', 'From template…', 'Import PDF…']) {
      expect(await screen.findByRole('menuitem', { name: new RegExp(name) })).toBeInTheDocument()
    }
  })
})
