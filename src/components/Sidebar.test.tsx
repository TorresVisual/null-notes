import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

vi.mock('../lib/tauri', () => ({
  api: { notes: { notesWithTag: vi.fn().mockResolvedValue([]) } },
}))
vi.mock('../hooks/useWorkspace', () => ({
  useWorkspace: () => ({ openWorkspace: vi.fn() }),
}))
vi.mock('../hooks/useCreateNote', () => ({ useCreateNote: () => vi.fn() }))
vi.mock('../hooks/useCreateFolder', () => ({ useCreateFolder: () => vi.fn() }))
vi.mock('../hooks/useCreateCanvasNote', () => ({ useCreateCanvasNote: () => vi.fn() }))

const props = { onSearchOpen: vi.fn(), onSettingsOpen: vi.fn(), onTemplateOpen: vi.fn() }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Sidebar Home button', () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [], folders: [], tags: [] })
  })

  it('is disabled with no workspace open', () => {
    useWorkspaceStore.setState({ path: null, activeTab: null, tagFilter: null })
    render(<Sidebar {...props} />)

    expect(screen.getByRole('button', { name: /Home/ })).toBeDisabled()
  })

  // Mirrors the existing Ctrl H menu accelerator (Layout's runCommand,
  // case 'home') — this button is the click-reachable equivalent, not a
  // second, independent implementation of "go home".
  it('returns to the home view when clicked', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ path: '/ws', activeTab: '/ws/Note.md', tagFilter: null })
    render(<Sidebar {...props} />)

    await user.click(screen.getByRole('button', { name: /Home/ }))

    expect(useWorkspaceStore.getState().activeTab).toBeNull()
  })
})
