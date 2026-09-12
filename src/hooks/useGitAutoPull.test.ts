import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitAutoPull } from './useGitAutoPull'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { git: { fetchAndCompare: vi.fn(), pushNotes: vi.fn() } },
}))

const git = vi.mocked(api.git)

describe('useGitAutoPull', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      gitDiverged: null,
      gitPullBlocked: null,
      gitAhead: null,
      repoMode: 'notesOnly',
      git: {
        prompted: true,
        autoCommit: true,
        idleMinutes: 10,
        skipHooks: false,
        autoPush: true,
        allowCodeRepoPush: false,
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sets gitDiverged when histories have diverged', async () => {
    git.fetchAndCompare.mockResolvedValue({
      kind: 'diverged',
      ahead: 1,
      behind: 2,
      localPaths: ['b.md'],
      remotePaths: ['a.md'],
    })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitDiverged).toEqual({
      ahead: 1,
      behind: 2,
      localPaths: ['b.md'],
      remotePaths: ['a.md'],
    })
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
    git.fetchAndCompare.mockResolvedValue({
      kind: 'blocked',
      output: 'would be overwritten by merge',
      paths: ['note.md'],
    })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitPullBlocked).toEqual({
      output: 'would be overwritten by merge',
      paths: ['note.md'],
    })
  })

  it('clears a stale gitPullBlocked once a later check succeeds', async () => {
    useWorkspaceStore.setState({ gitPullBlocked: { output: 'stale', paths: [] } })
    git.fetchAndCompare.mockResolvedValue({ kind: 'fastForwarded' })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitPullBlocked).toBeNull()
  })

  // #81: purely ahead retries the push right away rather than waiting for
  // the next auto-commit, since a stalled push may have no new edit to
  // trigger one for a long time.
  it('retries the push and clears gitAhead when purely ahead and the retry lands', async () => {
    git.fetchAndCompare.mockResolvedValue({ kind: 'ahead', ahead: 3 })
    git.pushNotes.mockResolvedValue({ kind: 'pushed' })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(git.pushNotes).toHaveBeenCalledWith('/ws', 'notesOnly', false)
    expect(useWorkspaceStore.getState().gitAhead).toBeNull()
  })

  it('surfaces gitAhead when the retried push still fails', async () => {
    git.fetchAndCompare.mockResolvedValue({ kind: 'ahead', ahead: 2 })
    git.pushNotes.mockResolvedValue({ kind: 'authFailed', output: 'denied' })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(useWorkspaceStore.getState().gitAhead).toBe(2)
  })

  it('surfaces gitAhead without pushing a CodeRepo workspace that never opted in', async () => {
    useWorkspaceStore.setState({ repoMode: 'codeRepo' })
    git.fetchAndCompare.mockResolvedValue({ kind: 'ahead', ahead: 1 })
    const { result } = renderHook(() => useGitAutoPull())

    await result.current.checkForUpdates('/ws')

    expect(git.pushNotes).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().gitAhead).toBe(1)
  })
})
