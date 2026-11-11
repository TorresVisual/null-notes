import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobileTreeNode } from './MobileTreeNode'
import { ActionSheet } from './ActionSheet'
import { useActionSheetStore } from '../store/actionSheet'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { deleteFolder, deleteNote, renameNote } from '../lib/noteActions'
import type { TreeEntry } from '../lib/folderTree'
import type { NoteMetadata } from '../types'

vi.mock('../lib/noteActions', () => ({
  deleteFolder: vi.fn(),
  deleteNote: vi.fn(),
  renameCanvas: vi.fn(),
  renameFolder: vi.fn(),
  renameNote: vi.fn(),
}))

const note: TreeEntry = { type: 'note', name: 'ss', path: '/ws/ss.md', note: { path: '/ws/ss.md' } as NoteMetadata }
const folder: TreeEntry = { type: 'folder', name: 'test', path: '/ws/test', children: [{ ...note, name: 'inner', path: '/ws/test/inner.md' } as TreeEntry] }

function mount(entry: TreeEntry) {
  return render(
    <>
      <ul><MobileTreeNode entry={entry} /></ul>
      <ActionSheet />
    </>,
  )
}

beforeEach(() => {
  useActionSheetStore.setState({ sheet: null })
  useWorkspaceStore.setState({ expandedFolders: [], activeTab: null, openTabs: [] })
  useNotesStore.setState({ notes: [{ path: '/ws/test/inner.md' } as NoteMetadata] })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('MobileTreeNode', () => {
  it('opens a note on tap', async () => {
    mount(note)
    await userEvent.click(screen.getByRole('button', { name: 'ss' }))
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/ss.md')
  })

  it('shows the note count and expands a folder on tap', async () => {
    mount(folder)
    expect(screen.getByText('1 note')).toBeInTheDocument()
    expect(screen.queryByText('inner')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('inner')).toBeInTheDocument()
  })

  it('the row menu button opens a sheet with Rename, Bookmark and Delete, and Delete runs after the sheet closes', async () => {
    mount(note)
    await userEvent.click(screen.getByRole('button', { name: 'Actions for ss' }))
    expect(screen.getByRole('dialog', { name: 'ss' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(expect.arrayContaining(['Rename', 'Bookmark', 'Delete']))

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteNote).toHaveBeenCalledWith('/ws/ss.md')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('routes folder actions to the folder helpers', async () => {
    mount(folder)
    await userEvent.click(screen.getByRole('button', { name: 'Actions for test' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteFolder).toHaveBeenCalledWith('/ws/test', 'test')
    expect(deleteNote).not.toHaveBeenCalled()
  })

  it('a long press opens the sheet without opening the note', () => {
    vi.useFakeTimers()
    mount(note)
    const row = screen.getByRole('button', { name: 'ss' })
    fireEvent.touchStart(row)
    act(() => vi.advanceTimersByTime(500))
    fireEvent.touchEnd(row)
    fireEvent.click(row)
    expect(useActionSheetStore.getState().sheet?.title).toBe('ss')
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
    expect(renameNote).not.toHaveBeenCalled()
  })

  it('a short press is just a tap', () => {
    vi.useFakeTimers()
    mount(note)
    const row = screen.getByRole('button', { name: 'ss' })
    fireEvent.touchStart(row)
    act(() => vi.advanceTimersByTime(200))
    fireEvent.touchEnd(row)
    fireEvent.click(row)
    expect(useActionSheetStore.getState().sheet).toBeNull()
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/ss.md')
  })
})
