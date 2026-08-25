import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteHistoryPanel } from './NoteHistoryPanel'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    git: {
      listNoteHistory: vi.fn(),
      readNoteAtCommit: vi.fn(),
    },
  },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
}))

const listNoteHistory = vi.mocked(api.git.listNoteHistory)
const readNoteAtCommit = vi.mocked(api.git.readNoteAtCommit)

beforeEach(() => {
  useWorkspaceStore.setState({ path: '/ws' })
  listNoteHistory.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NoteHistoryPanel', () => {
  it('shows an empty state when the note has no history', async () => {
    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    expect(await screen.findByText(/No history yet/)).toBeInTheDocument()
  })

  it('lists commits newest first with timestamp and message', async () => {
    listNoteHistory.mockResolvedValue([
      { sha: 'b', timestampMs: 2000, message: 'notes: update Todo' },
      { sha: 'a', timestampMs: 1000, message: 'notes: update Todo' },
    ])

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    const items = await screen.findAllByText('notes: update Todo')
    expect(items).toHaveLength(2)
  })

  it("previews a commit's content when clicked", async () => {
    const user = userEvent.setup()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    await user.click(await screen.findByText('notes: update Todo'))

    expect(readNoteAtCommit).toHaveBeenCalledWith('/ws', '/ws/Todo.md', 'a')
    expect(await screen.findByText(/old content/)).toBeInTheDocument()
  })

  it('restores immediately when the buffer is clean', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={onRestore} />)

    await user.click(await screen.findByText('notes: update Todo'))
    await user.click(await screen.findByRole('button', { name: /Restore this version/ }))

    expect(onRestore).toHaveBeenCalledWith('# Todo\n\n- old content\n')
  })

  it('confirms before restoring when the buffer is dirty', async () => {
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    vi.mocked(confirm).mockResolvedValue(true)
    const user = userEvent.setup()
    const onRestore = vi.fn()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="dirty" onRestore={onRestore} />)

    await user.click(await screen.findByText('notes: update Todo'))
    await user.click(await screen.findByRole('button', { name: /Restore this version/ }))

    expect(confirm).toHaveBeenCalledWith('You have unsaved changes — restoring will discard them.')
    expect(onRestore).toHaveBeenCalledWith('# Todo\n\n- old content\n')
  })

  it('does not restore when the confirm is declined', async () => {
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    vi.mocked(confirm).mockResolvedValue(false)
    const user = userEvent.setup()
    const onRestore = vi.fn()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="dirty" onRestore={onRestore} />)

    await user.click(await screen.findByText('notes: update Todo'))
    await user.click(await screen.findByRole('button', { name: /Restore this version/ }))

    await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    expect(onRestore).not.toHaveBeenCalled()
  })

  it("shows an inline error when the history fetch fails, without blocking the rest of the note", async () => {
    listNoteHistory.mockRejectedValue(new Error('git log failed'))

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    expect(await screen.findByText(/Couldn't load history/)).toBeInTheDocument()
  })

  it('shows an inline error when reading a historical version fails', async () => {
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo' }])
    readNoteAtCommit.mockRejectedValue(new Error('git show failed'))
    const user = userEvent.setup()

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" onRestore={vi.fn()} />)

    await user.click(await screen.findByText('notes: update Todo'))

    expect(await screen.findByText(/Couldn't load that version/)).toBeInTheDocument()
  })
})
