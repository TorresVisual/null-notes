import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TreeNode } from './TreeNode'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import type { NoteTreeNode } from '../lib/folderTree'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { delete: vi.fn(), rename: vi.fn(), scan: vi.fn() },
  },
}))

const notesApi = vi.mocked(api.notes)

const noteEntry: NoteTreeNode = {
  type: 'note',
  name: 'Lecture 7',
  path: '/ws/Lecture 7.md',
  note: { id: '1', title: 'Lecture 7', path: '/ws/Lecture 7.md', workspace: '/ws', updatedAt: 0 },
}

beforeEach(() => {
  useWorkspaceStore.setState({
    path: '/ws',
    openTabs: [noteEntry.path],
    activeTab: noteEntry.path,
    expandedFolders: [],
    gitPendingPaths: [],
  })
  useNotesStore.setState({ notes: [noteEntry.note], folders: [], tags: [] })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TreeNode delete (note)', () => {
  // The bug this guards against: the file disappearing locally while its
  // deletion never reaches Git, because nothing told the auto-commit batch
  // a path had been removed.
  it('queues the deleted note path for auto-commit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    notesApi.delete.mockResolvedValue(undefined)
    render(<TreeNode entry={noteEntry} depth={0} />)

    await userEvent.click(screen.getByRole('button', { name: `Delete ${noteEntry.name}` }))

    expect(notesApi.delete).toHaveBeenCalledWith(noteEntry.path)
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([noteEntry.path])
  })

  it('does nothing when the confirm dialog is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<TreeNode entry={noteEntry} depth={0} />)

    await userEvent.click(screen.getByRole('button', { name: `Delete ${noteEntry.name}` }))

    expect(notesApi.delete).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([])
  })
})
