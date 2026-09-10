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

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /History/ }))
}

describe('NoteHistoryPanel', () => {
  it('starts collapsed', async () => {
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo', path: '/ws/Todo.md' }])

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" currentContent="" onRestore={vi.fn()} />)

    await waitFor(() => expect(listNoteHistory).toHaveBeenCalled())
    expect(screen.queryByText('notes: update Todo')).not.toBeInTheDocument()
  })

  it('shows an empty state when the note has no history', async () => {
    const user = userEvent.setup()
    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" currentContent="" onRestore={vi.fn()} />)
    await expand(user)

    expect(await screen.findByText(/No history yet/)).toBeInTheDocument()
  })

  it('lists commits newest first with timestamp and message', async () => {
    const user = userEvent.setup()
    listNoteHistory.mockResolvedValue([
      { sha: 'b', timestampMs: 2000, message: 'notes: update Todo', path: '/ws/Todo.md' },
      { sha: 'a', timestampMs: 1000, message: 'notes: update Todo', path: '/ws/Todo.md' },
    ])

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" currentContent="" onRestore={vi.fn()} />)
    await expand(user)

    const items = await screen.findAllByText('notes: update Todo')
    expect(items).toHaveLength(2)
  })

  it('shows the diff nested under the clicked entry, not below the whole list', async () => {
    const user = userEvent.setup()
    listNoteHistory.mockResolvedValue([
      { sha: 'b', timestampMs: 2000, message: 'commit b', path: '/ws/Todo.md' },
      { sha: 'a', timestampMs: 1000, message: 'commit a', path: '/ws/Todo.md' },
    ])
    readNoteAtCommit.mockResolvedValue('old content')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" currentContent="" onRestore={vi.fn()} />)
    await expand(user)

    const bItem = await screen.findByText('commit b')
    await user.click(bItem)

    const diffLine = await screen.findByText(/old content/)
    expect(bItem.closest('li')).toContainElement(diffLine)
    expect(screen.getByText('commit a').closest('li')).not.toContainElement(diffLine)
  })

  it("previews a commit's content when clicked", async () => {
    const user = userEvent.setup()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo', path: '/ws/Todo.md' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" currentContent="" onRestore={vi.fn()} />)
    await expand(user)

    await user.click(await screen.findByText('notes: update Todo'))

    expect(readNoteAtCommit).toHaveBeenCalledWith('/ws', '/ws/Todo.md', 'a')
    expect(await screen.findByText(/old content/)).toBeInTheDocument()
  })

  it('closes the preview when the same entry is clicked again', async () => {
    const user = userEvent.setup()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo', path: '/ws/Todo.md' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" currentContent="" onRestore={vi.fn()} />)
    await expand(user)

    const item = await screen.findByText('notes: update Todo')
    await user.click(item)
    expect(await screen.findByText(/old content/)).toBeInTheDocument()

    await user.click(item)

    expect(screen.queryByText(/old content/)).not.toBeInTheDocument()
    expect(readNoteAtCommit).toHaveBeenCalledOnce()
  })

  it("reads a commit at that commit's own path, not the note's current path, so pre-rename history still loads", async () => {
    const user = userEvent.setup()
    listNoteHistory.mockResolvedValue([
      { sha: 'old', timestampMs: 1000, message: 'notes: update Old', path: '/ws/Old.md' },
    ])
    readNoteAtCommit.mockResolvedValue('# Old\n')

    render(<NoteHistoryPanel notePath="/ws/New.md" saveState="clean" currentContent="" onRestore={vi.fn()} />)
    await expand(user)

    await user.click(await screen.findByText('notes: update Old'))

    expect(readNoteAtCommit).toHaveBeenCalledWith('/ws', '/ws/Old.md', 'old')
  })

  it('renders a line diff against the current buffer, not the raw historical text', async () => {
    const user = userEvent.setup()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo', path: '/ws/Todo.md' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- kept\n- removed line\n')

    render(
      <NoteHistoryPanel
        notePath="/ws/Todo.md"
        saveState="clean"
        currentContent={'# Todo\n\n- kept\n- added line\n'}
        onRestore={vi.fn()}
      />
    )
    await expand(user)
    await user.click(await screen.findByText('notes: update Todo'))

    expect(await screen.findByText(/removed line/)).toHaveClass('note-history-diff-remove')
    expect(await screen.findByText(/added line/)).toHaveClass('note-history-diff-add')
    expect(await screen.findByText(/^\s*- kept$/)).toHaveClass('note-history-diff-same')
  })

  it('restores immediately when the buffer is clean', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo', path: '/ws/Todo.md' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" currentContent="" onRestore={onRestore} />)
    await expand(user)

    await user.click(await screen.findByText('notes: update Todo'))
    await user.click(await screen.findByRole('button', { name: /Restore this version/ }))

    expect(onRestore).toHaveBeenCalledWith('# Todo\n\n- old content\n')
  })

  it('confirms before restoring when the buffer is dirty', async () => {
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    vi.mocked(confirm).mockResolvedValue(true)
    const user = userEvent.setup()
    const onRestore = vi.fn()
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo', path: '/ws/Todo.md' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="dirty" currentContent="" onRestore={onRestore} />)
    await expand(user)

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
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo', path: '/ws/Todo.md' }])
    readNoteAtCommit.mockResolvedValue('# Todo\n\n- old content\n')

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="dirty" currentContent="" onRestore={onRestore} />)
    await expand(user)

    await user.click(await screen.findByText('notes: update Todo'))
    await user.click(await screen.findByRole('button', { name: /Restore this version/ }))

    await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    expect(onRestore).not.toHaveBeenCalled()
  })

  it("shows an inline error when the history fetch fails, without blocking the rest of the note", async () => {
    const user = userEvent.setup()
    listNoteHistory.mockRejectedValue(new Error('git log failed'))

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" currentContent="" onRestore={vi.fn()} />)
    await expand(user)

    expect(await screen.findByText(/Couldn't load history/)).toBeInTheDocument()
  })

  it('shows an inline error when reading a historical version fails', async () => {
    listNoteHistory.mockResolvedValue([{ sha: 'a', timestampMs: 1000, message: 'notes: update Todo', path: '/ws/Todo.md' }])
    readNoteAtCommit.mockRejectedValue(new Error('git show failed'))
    const user = userEvent.setup()

    render(<NoteHistoryPanel notePath="/ws/Todo.md" saveState="clean" currentContent="" onRestore={vi.fn()} />)
    await expand(user)

    await user.click(await screen.findByText('notes: update Todo'))

    expect(await screen.findByText(/Couldn't load that version/)).toBeInTheDocument()
  })
})
