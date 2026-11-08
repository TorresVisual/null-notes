import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useExternalChanges } from './useExternalChanges'
import { useWorkspaceStore } from '../store/workspace'

const listeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => unknown>())

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => unknown) => {
    listeners.set(name, handler)
    return () => listeners.delete(name)
  }),
}))
vi.mock('../lib/tauri', () => ({ api: { notes: { reindexFromDisk: vi.fn() } } }))
vi.mock('./useWorkspace', () => ({ refreshTree: vi.fn(), refreshTags: vi.fn() }))
vi.mock('../store/bookmarks', () => ({
  useBookmarksStore: { getState: () => ({ load: vi.fn(), reload: vi.fn() }) },
}))
vi.mock('../store/baseRows', () => ({
  useBaseRowsStore: { getState: () => ({ reload: vi.fn() }) },
}))

describe('useExternalChanges', () => {
  beforeEach(() => {
    listeners.clear()
    useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
  })

  it('queues a watcher-reported canvas or base for the next auto-commit', async () => {
    renderHook(() => useExternalChanges())
    await vi.waitFor(() => expect(listeners.has('canvas-changed')).toBe(true))

    listeners.get('canvas-changed')?.({ payload: ['/ws/map.canvas', '/ws/tasks.base'] })

    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/map.canvas', '/ws/tasks.base'])
  })

  it('queues a watcher-reported note change, such as a delete made outside the app', async () => {
    renderHook(() => useExternalChanges())
    await vi.waitFor(() => expect(listeners.has('workspace-changed')).toBe(true))

    await listeners.get('workspace-changed')?.({ payload: ['/ws/gone.md'] })

    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/gone.md'])
  })
})
