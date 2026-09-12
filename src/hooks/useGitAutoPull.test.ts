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
    useWorkspaceStore.setState({ gitDiverged: null, gitPullBlocked: null })
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
    expect(useWorkspaceStore.getState().gitPullBlocked).toBeNull()
  })

  it('sets gitPullBlocked when the ff-only merge itself refuses', async () => {
    git.fetchAndCompare.mockResolvedValue({ kind: 'blocked', output: 'would be overwritten by merge' })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitPullBlocked).toBe('would be overwritten by merge')
  })

  it('clears a stale gitPullBlocked once a later check succeeds', async () => {
    useWorkspaceStore.setState({ gitPullBlocked: 'stale' })
    git.fetchAndCompare.mockResolvedValue({ kind: 'fastForwarded' })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitPullBlocked).toBeNull()
  })
})
