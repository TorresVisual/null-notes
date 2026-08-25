import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { TooltipProvider } from './ui/tooltip'

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
