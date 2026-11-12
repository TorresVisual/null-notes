import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDeleteLocalWorkspace } from './useDeleteLocalWorkspace'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

const closeWorkspace = vi.fn()
const confirm = vi.fn()

vi.mock('./useWorkspace', () => ({ useWorkspace: () => ({ closeWorkspace }) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: (...args: unknown[]) => confirm(...args) }))
vi.mock('../lib/tauri', () => ({ api: { workspace: { delete: vi.fn() } } }))

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState({ path: '/ws/notes', recentWorkspaces: ['/ws/notes', '/ws/other'] })
})

describe('useDeleteLocalWorkspace', () => {
  it('closes, deletes and updates recents once confirmed', async () => {
    confirm.mockResolvedValue(true)
    vi.mocked(api.workspace.delete).mockResolvedValue(['/ws/other'])
    const { result } = renderHook(() => useDeleteLocalWorkspace())

    await result.current()

    expect(closeWorkspace).toHaveBeenCalledTimes(1)
    expect(api.workspace.delete).toHaveBeenCalledWith('/ws/notes')
    expect(useWorkspaceStore.getState().recentWorkspaces).toEqual(['/ws/other'])
  })

  it('does nothing when the user declines', async () => {
    confirm.mockResolvedValue(false)
    const { result } = renderHook(() => useDeleteLocalWorkspace())

    await result.current()

    expect(closeWorkspace).not.toHaveBeenCalled()
    expect(api.workspace.delete).not.toHaveBeenCalled()
  })
})
