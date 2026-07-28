import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCreateNote } from './useCreateNote'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

vi.mock('../lib/tauri', () => ({
  api: { notes: { create: vi.fn() } },
}))

const notes = vi.mocked(api.notes)

function meta(path: string, title: string): NoteMetadata {
  return { id: 'id', title, path, workspace: '/ws', updatedAt: 0 }
}

describe('useCreateNote', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      path: '/ws',
      selectedFolder: null,
      openTabs: [],
      activeTab: null,
      folderError: null,
    })
    useNotesStore.setState({ notes: [] })
    notes.create.mockResolvedValue(meta('/ws/Missing.md', 'Missing'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('creates the note in the selected folder, stores it and opens it', async () => {
    useWorkspaceStore.setState({ selectedFolder: '/ws/Course101' })
    notes.create.mockResolvedValue(meta('/ws/Course101/Missing.md', 'Missing'))
    const { result } = renderHook(() => useCreateNote())

    await result.current('Missing')

    expect(notes.create).toHaveBeenCalledWith('/ws', '/ws/Course101', 'Missing')
    expect(useNotesStore.getState().notes[0]?.title).toBe('Missing')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/Course101/Missing.md')
  })

  it('falls back to the workspace root when no folder is selected', async () => {
    const { result } = renderHook(() => useCreateNote())

    await result.current('Missing')

    expect(notes.create).toHaveBeenCalledWith('/ws', '/ws', 'Missing')
  })

  it('reports a failed create and opens nothing', async () => {
    notes.create.mockRejectedValue(new Error('a note named "Missing.md" already exists here'))
    const { result } = renderHook(() => useCreateNote())

    const created = await result.current('Missing')

    expect(created).toBeNull()
    expect(useNotesStore.getState().notes).toHaveLength(0)
    expect(useWorkspaceStore.getState().openTabs).toHaveLength(0)
    expect(useWorkspaceStore.getState().folderError).toBe(
      'a note named "Missing.md" already exists here',
    )
  })

  // Double-clicking a missing [[link]] must not race two creates for one title.
  it('ignores a second call while the first is still in flight', async () => {
    const { result } = renderHook(() => useCreateNote())

    const [first, second] = await Promise.all([
      result.current('Missing'),
      result.current('Missing'),
    ])

    expect(notes.create).toHaveBeenCalledTimes(1)
    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('does nothing without an open workspace', async () => {
    useWorkspaceStore.setState({ path: null })
    const { result } = renderHook(() => useCreateNote())

    expect(await result.current('Missing')).toBeNull()
    expect(notes.create).not.toHaveBeenCalled()
  })
})
