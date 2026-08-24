import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCreateFolder } from './useCreateFolder'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { notes: { createFolder: vi.fn(), scan: vi.fn() } },
}))

const notes = vi.mocked(api.notes)

describe('useCreateFolder', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      path: '/ws',
      selectedFolder: null,
      expandedFolders: [],
      folderError: null,
    })
    useNotesStore.setState({ notes: [], folders: [] })
    notes.scan.mockResolvedValue({ notes: [], folders: [] })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('creates the folder under the workspace root, selects and expands it', async () => {
    notes.createFolder.mockResolvedValue('/ws/Course101')
    const { result } = renderHook(() => useCreateFolder())

    await result.current('Course101')

    expect(notes.createFolder).toHaveBeenCalledWith('/ws', 'Course101')
    expect(useWorkspaceStore.getState().selectedFolder).toBe('/ws/Course101')
    expect(useWorkspaceStore.getState().expandedFolders).toContain('/ws/Course101')
  })

  it('creates a nested folder under the selected one', async () => {
    useWorkspaceStore.setState({ selectedFolder: '/ws/Course101' })
    notes.createFolder.mockResolvedValue('/ws/Course101/Week1')
    const { result } = renderHook(() => useCreateFolder())

    await result.current('Week1')

    expect(notes.createFolder).toHaveBeenCalledWith('/ws/Course101', 'Week1')
  })

  // The bug this guards against: a folder created inside another collapsed
  // folder rendered nowhere in the sidebar, same as a note created inside one.
  it('reports a failed create without selecting or expanding anything', async () => {
    notes.createFolder.mockRejectedValue(new Error('a folder named "Course101" already exists'))
    const { result } = renderHook(() => useCreateFolder())

    const created = await result.current('Course101')

    expect(created).toBeNull()
    expect(useWorkspaceStore.getState().selectedFolder).toBeNull()
    expect(useWorkspaceStore.getState().expandedFolders).toEqual([])
    expect(useWorkspaceStore.getState().folderError).toBe('a folder named "Course101" already exists')
  })

  it('does nothing without an open workspace', async () => {
    useWorkspaceStore.setState({ path: null })
    const { result } = renderHook(() => useCreateFolder())

    expect(await result.current('Course101')).toBeNull()
    expect(notes.createFolder).not.toHaveBeenCalled()
  })
})
