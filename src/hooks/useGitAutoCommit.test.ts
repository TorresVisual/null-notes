import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGitAutoCommit } from './useGitAutoCommit'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { git: { autoCommit: vi.fn(), pushNotes: vi.fn() } },
}))

const git = vi.mocked(api.git)

describe('useGitAutoCommit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useWorkspaceStore.setState({
      path: '/ws',
      repoMode: 'notesOnly',
      git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: false },
      gitPendingPaths: [],
      gitCommitStatus: 'idle',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('commits after the configured idle window, not immediately', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(9 * 60_000))
    expect(git.autoCommit).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(1 * 60_000))
    expect(git.autoCommit).toHaveBeenCalledWith('/ws', ['/ws/a.md'], false)
  })

  it('clears pending paths and sets status after a successful commit', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([])
    expect(useWorkspaceStore.getState().gitCommitStatus).toBe('committed')
  })

  it('does nothing when auto-commit is off', async () => {
    useWorkspaceStore.setState({
      git: { prompted: true, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: false },
    })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(60 * 60_000))

    expect(git.autoCommit).not.toHaveBeenCalled()
  })

  it('flushGitCommit commits immediately, for session-end use', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    const { result } = renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => result.current.flushGitCommit())

    expect(git.autoCommit).toHaveBeenCalledWith('/ws', ['/ws/a.md'], false)
  })

  it('a non-committed outcome leaves the batch pending for the next trigger, carrying the reason as detail', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'skipped', reason: 'a rebase is in progress' })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/a.md'])
    expect(useWorkspaceStore.getState().gitCommitStatus).toBe('skipped')
    expect(useWorkspaceStore.getState().gitCommitDetail).toBe('a rebase is in progress')
  })

  it('a failed pre-commit hook carries its output as detail, distinct from a plain skip', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'hookFailed', output: 'lint failed on Notes.md' })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/a.md'])
    expect(useWorkspaceStore.getState().gitCommitStatus).toBe('skipped')
    expect(useWorkspaceStore.getState().gitCommitDetail).toBe('lint failed on Notes.md')
  })

  it('a thrown commit error sets status and carries the error as detail', async () => {
    git.autoCommit.mockRejectedValue(new Error('index.lock exists'))
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(useWorkspaceStore.getState().gitCommitStatus).toBe('error')
    expect(useWorkspaceStore.getState().gitCommitDetail).toContain('index.lock exists')
  })

  it('pushes after a successful commit when notes-only and autoPush is on', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    git.pushNotes.mockResolvedValue({ kind: 'pushed' })
    useWorkspaceStore.setState({
      git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true },
    })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(git.pushNotes).toHaveBeenCalledWith('/ws', 'notesOnly')
  })

  it('a failed push sets its own status and detail, leaving the successful commit alone', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    git.pushNotes.mockRejectedValue(new Error('remote rejected'))
    useWorkspaceStore.setState({
      git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true },
    })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(useWorkspaceStore.getState().gitCommitStatus).toBe('pushFailed')
    expect(useWorkspaceStore.getState().gitCommitDetail).toContain('remote rejected')
    // The commit itself already succeeded — pending paths were already
    // cleared before the push was attempted.
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([])
  })

  it('never pushes a code-repo workspace, even with autoPush on', async () => {
    git.autoCommit.mockResolvedValue({ kind: 'committed' })
    useWorkspaceStore.setState({
      repoMode: 'codeRepo',
      git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true },
    })
    renderHook(() => useGitAutoCommit())

    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))

    expect(git.pushNotes).not.toHaveBeenCalled()
  })
})
