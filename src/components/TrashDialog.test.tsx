import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrashDialog } from './TrashDialog'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { scan: vi.fn() },
    trash: { list: vi.fn(), restore: vi.fn(), purge: vi.fn(), empty: vi.fn() },
  },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn().mockResolvedValue(true) }))

const trashApi = vi.mocked(api.trash)

const entry = {
  id: 'trash-1',
  workspace: '/ws',
  originalPath: '/ws/Lecture 7.md',
  isFolder: false,
  name: 'Lecture 7',
  trashedAt: 0,
}

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
  vi.mocked(api.notes.scan).mockResolvedValue({ notes: [], folders: [], canvases: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TrashDialog', () => {
  it('shows an empty hint when nothing is trashed', async () => {
    trashApi.list.mockResolvedValue([])
    render(<TrashDialog onClose={vi.fn()} />)

    expect(await screen.findByText('Nothing in the trash.')).toBeInTheDocument()
  })

  it('restores an entry and removes it from the list', async () => {
    trashApi.list.mockResolvedValue([entry])
    trashApi.restore.mockResolvedValue('/ws/Lecture 7.md')
    render(<TrashDialog onClose={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(trashApi.restore).toHaveBeenCalledWith('/ws', 'trash-1'))
    await waitFor(() => expect(screen.queryByText('Lecture 7')).not.toBeInTheDocument())
  })

  it('deletes an entry forever after confirming', async () => {
    trashApi.list.mockResolvedValue([entry])
    trashApi.purge.mockResolvedValue(undefined)
    render(<TrashDialog onClose={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Delete forever' }))

    await waitFor(() => expect(trashApi.purge).toHaveBeenCalledWith('trash-1'))
  })
})
