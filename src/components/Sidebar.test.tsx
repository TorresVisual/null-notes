import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { platform } from '@tauri-apps/plugin-os'
import { Sidebar } from './Sidebar'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useMobileSidebarStore } from '../store/mobileSidebar'
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

describe('Sidebar drawer on mobile', () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [], folders: [], tags: [] })
    useWorkspaceStore.setState({ path: '/ws', activeTab: null, tagFilter: null })
    useMobileSidebarStore.setState({ open: true })
  })

  it('has the drawer class and is open when the store says open', () => {
    vi.mocked(platform).mockReturnValue('ios')
    const { container } = renderSidebar()

    const aside = container.querySelector('aside')
    expect(aside).toHaveClass('sidebar--drawer')
    expect(aside).toHaveClass('sidebar--open')
  })

  it('closes when activeTab changes', () => {
    vi.mocked(platform).mockReturnValue('ios')
    const { rerender } = renderSidebar()
    expect(useMobileSidebarStore.getState().open).toBe(true)

    useWorkspaceStore.setState({ activeTab: '/ws/note.md' })
    rerender(
      <TooltipProvider>
        <Sidebar {...props} />
      </TooltipProvider>,
    )

    expect(useMobileSidebarStore.getState().open).toBe(false)
  })

  it('closes when a secondary action (e.g. Search) is triggered', async () => {
    const user = userEvent.setup()
    vi.mocked(platform).mockReturnValue('ios')
    const onSearchOpen = vi.fn()
    render(
      <TooltipProvider>
        <Sidebar {...props} onSearchOpen={onSearchOpen} />
      </TooltipProvider>,
    )

    await user.click(screen.getByText('Search'))

    expect(onSearchOpen).toHaveBeenCalled()
    expect(useMobileSidebarStore.getState().open).toBe(false)
  })

  it('has no drawer class on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    const { container } = renderSidebar()

    expect(container.querySelector('aside')).not.toHaveClass('sidebar--drawer')
  })
})
