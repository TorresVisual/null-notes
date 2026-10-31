import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FolderTree } from './FolderTree'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import type { NoteTreeNode } from '../lib/folderTree'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { moveNote: vi.fn(), renameFolder: vi.fn(), scan: vi.fn().mockResolvedValue({ notes: [], folders: [] }) },
  },
}))

const notesApi = vi.mocked(api.notes)

const noteEntry: NoteTreeNode = {
  type: 'note',
  name: 'Root Note',
  path: '/ws/Root Note.md',
  note: { id: '1', title: 'Root Note', path: '/ws/Root Note.md', workspace: '/ws', updatedAt: 0 },
}

beforeEach(() => {
  useWorkspaceStore.setState({
    path: '/ws',
    openTabs: [],
    activeTab: null,
    expandedFolders: [],
    selectedFolder: null,
    folderError: null,
    gitPendingPaths: [],
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

// The bug this guards against: the only root-drop target was a small,
// far-away workspace-name label few users found by dragging. The root-level
// list itself — which already fills the sidebar's whole remaining height —
// is a much bigger, more discoverable target for the same "move to root"
// action, and it's the one place FolderTree is ever rendered (nested
// folders render their own <ul> directly in TreeNode, not through this
// component), so attaching the handler here can't misfire on a subfolder.
describe('FolderTree root drop target', () => {
  it('moves a dropped note back to the workspace root', async () => {
    notesApi.moveNote.mockResolvedValue('/ws/a.md')
    render(<FolderTree entries={[noteEntry]} />)

    const list = document.querySelector('.folder-tree')!
    fireEvent.drop(list, {
      dataTransfer: { getData: (type: string) => (type === 'text/note-path' ? '/ws/Sub/a.md' : '') },
    })

    await waitFor(() => {
      expect(notesApi.moveNote).toHaveBeenCalledWith('/ws/Sub/a.md', '/ws', '/ws')
    })
    // #18: a root-drop move wasn't queuing its paths into the auto-commit
    // batch, so the move landed on disk but never got auto-committed.
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(
      expect.arrayContaining(['/ws/Sub/a.md', '/ws/a.md']),
    )
  })

  it('moves a dropped folder back to the workspace root', async () => {
    notesApi.renameFolder.mockResolvedValue(undefined)
    render(<FolderTree entries={[noteEntry]} />)

    const list = document.querySelector('.folder-tree')!
    fireEvent.drop(list, {
      dataTransfer: { getData: (type: string) => (type === 'text/folder-path' ? '/ws/Sub/Nested' : '') },
    })

    await waitFor(() => {
      expect(notesApi.renameFolder).toHaveBeenCalledWith('/ws/Sub/Nested', '/ws/Nested')
    })
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(
      expect.arrayContaining(['/ws/Sub/Nested', '/ws/Nested']),
    )
  })

  it('does nothing when the drop carries neither a note nor a folder path', () => {
    render(<FolderTree entries={[noteEntry]} />)

    const list = document.querySelector('.folder-tree')!
    fireEvent.drop(list, { dataTransfer: { getData: () => '' } })

    expect(notesApi.moveNote).not.toHaveBeenCalled()
    expect(notesApi.renameFolder).not.toHaveBeenCalled()
  })

  it('still renders a root-level note row that can be clicked', () => {
    render(<FolderTree entries={[noteEntry]} />)

    expect(screen.getByText('Root Note')).toBeInTheDocument()
  })

  // The bug this guards against: dragleave doesn't reliably fire for every
  // child-boundary crossing as the pointer moves around inside the list, so
  // a completed drag could leave the highlight stuck on even though the
  // drop itself worked. dragend always fires exactly once when a drag
  // concludes, so it's used as the reliable fallback to clear it.
  it('clears the drag-over highlight on dragend even without a preceding dragleave', () => {
    render(<FolderTree entries={[noteEntry]} />)
    const list = document.querySelector('.folder-tree')!

    fireEvent.dragOver(list)
    expect(list.className).toContain('drag-over')

    fireEvent.dragEnd(list)
    expect(list.className).not.toContain('drag-over')
  })
})
