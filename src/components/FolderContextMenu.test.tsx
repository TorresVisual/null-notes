import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FolderContextMenu } from './FolderContextMenu'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { deleteFolder: vi.fn(), renameFolder: vi.fn(), scan: vi.fn() },
  },
}))

const notesApi = vi.mocked(api.notes)

beforeEach(() => {
  useWorkspaceStore.setState({
    path: '/ws',
    openTabs: [],
    activeTab: null,
    gitPendingPaths: [],
    folderContextMenu: { path: '/ws/Old Course', x: 0, y: 0 },
  })
  useNotesStore.setState({
    notes: [
      { id: '1', title: 'L1', path: '/ws/Old Course/L1.md', workspace: '/ws', updatedAt: 0 },
      { id: '2', title: 'L2', path: '/ws/Old Course/L2.md', workspace: '/ws', updatedAt: 0 },
    ],
    folders: [],
    tags: [],
  })
  notesApi.scan.mockResolvedValue({ notes: [], folders: [] })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('FolderContextMenu delete', () => {
  // The bug this guards against: deleting a whole course folder removed the
  // files locally but never queued the subtree for auto-commit, so the
  // deletion silently never reached the repo. A single directory pathspec
  // covers every note under it — no need to enumerate each one.
  it('queues the deleted folder path for auto-commit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    notesApi.deleteFolder.mockResolvedValue(undefined)
    render(<FolderContextMenu />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(notesApi.deleteFolder).toHaveBeenCalledWith('/ws/Old Course')
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/Old Course'])
  })

  it('does nothing when the confirm dialog is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<FolderContextMenu />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(notesApi.deleteFolder).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([])
  })
})
