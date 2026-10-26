import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { confirm } from '@tauri-apps/plugin-dialog'
import { TreeNode } from './TreeNode'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import type { FolderTreeNode, NoteTreeNode } from '../lib/folderTree'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: {
      delete: vi.fn(),
      rename: vi.fn(),
      scan: vi.fn(),
      renameFolder: vi.fn(),
      moveNote: vi.fn(),
      deleteFolder: vi.fn(),
    },
  },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  message: vi.fn(),
}))

const notesApi = vi.mocked(api.notes)
const dialog = vi.mocked({ confirm })

const noteEntry: NoteTreeNode = {
  type: 'note',
  name: 'Lecture 7',
  path: '/ws/Lecture 7.md',
  note: { id: '1', title: 'Lecture 7', path: '/ws/Lecture 7.md', workspace: '/ws', updatedAt: 0 },
}

const folderEntry: FolderTreeNode = {
  type: 'folder',
  name: 'Target',
  path: '/ws/Target',
  children: [],
}

function dropWithPaths(target: Element, data: Record<string, string>) {
  fireEvent.drop(target, { dataTransfer: { getData: (type: string) => data[type] ?? '' } })
}

beforeEach(() => {
  useWorkspaceStore.setState({
    path: '/ws',
    openTabs: [noteEntry.path],
    activeTab: noteEntry.path,
    expandedFolders: [],
    selectedFolder: null,
    gitPendingPaths: [],
  })
  useNotesStore.setState({ notes: [noteEntry.note], folders: [], tags: [] })
  notesApi.scan.mockResolvedValue({ notes: [], folders: [] })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TreeNode delete (note)', () => {
  // The bug this guards against: the file disappearing locally while its
  // deletion never reaches Git, because nothing told the auto-commit batch
  // a path had been removed.
  it('queues the deleted note path for auto-commit', async () => {
    dialog.confirm.mockResolvedValue(true)
    notesApi.delete.mockResolvedValue(undefined)
    render(<TreeNode entry={noteEntry} />)

    await userEvent.click(screen.getByRole('button', { name: `Delete ${noteEntry.name}` }))

    expect(notesApi.delete).toHaveBeenCalledWith(noteEntry.note.workspace, noteEntry.path)
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(
      expect.arrayContaining([
        noteEntry.path,
        `${noteEntry.path.replace(/\.md$/, '')}.ink`,
        `${noteEntry.path.replace(/\.md$/, '')}.pdf`,
        `${noteEntry.path.replace(/\.md$/, '')}.diagrams`,
        `${noteEntry.path.replace(/\.md$/, '')}.assets`,
      ]),
    )
  })

  it('does nothing when the confirm dialog is declined', async () => {
    dialog.confirm.mockResolvedValue(false)
    render(<TreeNode entry={noteEntry} />)

    await userEvent.click(screen.getByRole('button', { name: `Delete ${noteEntry.name}` }))

    expect(notesApi.delete).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([])
  })
})

describe('TreeNode delete (folder, via right-click context menu)', () => {
  // The bug this guards against: deleting a whole course folder removed the
  // files locally but never queued the subtree for auto-commit, so the
  // deletion silently never reached the repo. A single directory pathspec
  // covers every note under it — no need to enumerate each one.
  it('queues the deleted folder path for auto-commit', async () => {
    useNotesStore.setState({
      notes: [
        { id: '1', title: 'L1', path: '/ws/Target/L1.md', workspace: '/ws', updatedAt: 0 },
        { id: '2', title: 'L2', path: '/ws/Target/L2.md', workspace: '/ws', updatedAt: 0 },
      ],
      folders: [],
      tags: [],
    })
    dialog.confirm.mockResolvedValue(true)
    notesApi.deleteFolder.mockResolvedValue(undefined)
    render(<TreeNode entry={folderEntry} />)

    fireEvent.contextMenu(screen.getByText('Target').closest('.tree-folder')!)
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }))

    expect(notesApi.deleteFolder).toHaveBeenCalledWith('/ws/Target')
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/Target'])
  })

  it('does nothing when the confirm dialog is declined', async () => {
    dialog.confirm.mockResolvedValue(false)
    render(<TreeNode entry={folderEntry} />)

    fireEvent.contextMenu(screen.getByText('Target').closest('.tree-folder')!)
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }))

    expect(notesApi.deleteFolder).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([])
  })
})

describe('TreeNode drop (folder)', () => {
  it('nests a dropped folder inside the target folder', async () => {
    notesApi.renameFolder.mockResolvedValue(undefined)
    render(<TreeNode entry={folderEntry} />)

    const row = screen.getByText('Target').closest('.tree-folder')!
    dropWithPaths(row, { 'text/folder-path': '/ws/Source' })

    await waitFor(() => {
      expect(notesApi.renameFolder).toHaveBeenCalledWith('/ws/Source', '/ws/Target/Source')
    })
  })

  it('refuses to drop a folder onto itself', () => {
    render(<TreeNode entry={folderEntry} />)

    const row = screen.getByText('Target').closest('.tree-folder')!
    dropWithPaths(row, { 'text/folder-path': '/ws/Target' })

    expect(notesApi.renameFolder).not.toHaveBeenCalled()
  })

  it('refuses to drop a folder onto its own descendant', () => {
    const nested: FolderTreeNode = { ...folderEntry, path: '/ws/Source/Nested' }
    render(<TreeNode entry={nested} />)

    const row = screen.getByText('Target').closest('.tree-folder')!
    dropWithPaths(row, { 'text/folder-path': '/ws/Source' })

    expect(notesApi.renameFolder).not.toHaveBeenCalled()
  })

  it('moves a dropped note into the target folder', async () => {
    notesApi.moveNote.mockResolvedValue('/ws/Target/a.md')
    render(<TreeNode entry={folderEntry} />)

    const row = screen.getByText('Target').closest('.tree-folder')!
    dropWithPaths(row, { 'text/note-path': '/ws/a.md' })

    await waitFor(() => {
      expect(notesApi.moveNote).toHaveBeenCalledWith('/ws/a.md', '/ws/Target')
    })
    expect(notesApi.renameFolder).not.toHaveBeenCalled()
  })

  // The bug this guards against: a note or folder dropped into a collapsed
  // folder had nothing on screen to show it had landed anywhere.
  it('expands the target folder after a successful drop', async () => {
    notesApi.moveNote.mockResolvedValue('/ws/Target/a.md')
    render(<TreeNode entry={folderEntry} />)

    const row = screen.getByText('Target').closest('.tree-folder')!
    dropWithPaths(row, { 'text/note-path': '/ws/a.md' })

    await waitFor(() => {
      expect(useWorkspaceStore.getState().expandedFolders).toContain('/ws/Target')
    })
  })
})
