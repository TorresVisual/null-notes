import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitAutoPull } from './useGitAutoPull'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { git: { fetchAndCompare: vi.fn() } },
}))

const git = vi.mocked(api.git)

describe('useGitAutoPull', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ gitDiverged: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sets gitDiverged when histories have diverged', async () => {
    git.fetchAndCompare.mockResolvedValue({ kind: 'diverged', ahead: 1, behind: 2 })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitDiverged).toEqual({ ahead: 1, behind: 2 })
  })

  it('leaves gitDiverged null on a silent fast-forward', async () => {
    git.fetchAndCompare.mockResolvedValue({ kind: 'fastForwarded' })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitDiverged).toBeNull()
  })

  it('never blocks on a fetch failure', async () => {
    git.fetchAndCompare.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useGitAutoPull())

    await expect(result.current.checkForUpdates('/ws')).resolves.toBeUndefined()
    expect(useWorkspaceStore.getState().gitDiverged).toBeNull()
  })
})
