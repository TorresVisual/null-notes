import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWorkspace } from './useWorkspace'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import type { WorkspaceState, WorkspaceTree } from '../types'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { scan: vi.fn(), listTags: vi.fn() },
    workspace: { load: vi.fn(), save: vi.fn(), watch: vi.fn(), remember: vi.fn() },
    git: { detectRepo: vi.fn(), detectPriorAutomation: vi.fn(), fetchAndCompare: vi.fn(), autoCommit: vi.fn() },
  },
}))

const notes = vi.mocked(api.notes)
const workspace = vi.mocked(api.workspace)
const git = vi.mocked(api.git)

const emptyTree: WorkspaceTree = { notes: [], folders: [] }
const emptySession: WorkspaceState = {
  openTabs: [],
  activeTab: null,
  expandedFolders: [],
  recentSearches: [],
  git: { prompted: false, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
}

describe('useWorkspace', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      path: null,
      openTabs: [],
      activeTab: null,
      expandedFolders: [],
      repoMode: null,
      folderLoading: false,
      folderError: null,
      git: { prompted: false, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
    })
    useNotesStore.setState({ notes: [], folders: [], tags: [] })
    notes.scan.mockResolvedValue(emptyTree)
    notes.listTags.mockResolvedValue([])
    workspace.load.mockResolvedValue(emptySession)
    workspace.save.mockResolvedValue(undefined)
    workspace.watch.mockResolvedValue(undefined)
    workspace.remember.mockResolvedValue([])
    git.detectRepo.mockResolvedValue(null)
    git.detectPriorAutomation.mockResolvedValue(false)
    git.fetchAndCompare.mockResolvedValue({ kind: 'upToDate' })
    git.autoCommit.mockResolvedValue({ kind: 'nothingToCommit' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads the persisted git config into the store', async () => {
    workspace.load.mockResolvedValue({ ...emptySession, git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false } })
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(useWorkspaceStore.getState().git).toEqual({ prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false })
  })

  it('sets folderLoading true while scanning, false once settled', async () => {
    const { result } = renderHook(() => useWorkspace())

    const promise = result.current.openWorkspaceAt('/ws')
    expect(useWorkspaceStore.getState().folderLoading).toBe(true)

    await promise
    expect(useWorkspaceStore.getState().folderLoading).toBe(false)
  })

  it('clears folderLoading even when the scan fails', async () => {
    notes.scan.mockRejectedValue(new Error('not found'))
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(useWorkspaceStore.getState().folderLoading).toBe(false)
    expect(useWorkspaceStore.getState().folderError).toBe('not found')
  })

  it('does not persist to recent workspaces when remember is false', async () => {
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws', { remember: false })

    expect(workspace.remember).not.toHaveBeenCalled()
  })

  it('detects the repo mode after opening and stores it', async () => {
    git.detectRepo.mockResolvedValue('notesOnly')
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(git.detectRepo).toHaveBeenCalledWith('/ws')
    expect(useWorkspaceStore.getState().repoMode).toBe('notesOnly')
  })

  it('stays null when the workspace is not a git repository', async () => {
    git.detectRepo.mockResolvedValue(null)
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(useWorkspaceStore.getState().repoMode).toBeNull()
  })

  // A missing `git` binary must not block opening the workspace — detection
  // is best-effort, unlike the scan/load pair the open itself depends on.
  it('degrades to no repo mode, not a failed open, when detection itself fails', async () => {
    git.detectRepo.mockRejectedValue(new Error('git is not available on PATH'))
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(useWorkspaceStore.getState().path).toBe('/ws')
    expect(useWorkspaceStore.getState().repoMode).toBeNull()
  })

  it('fetches and compares once a repo is detected', async () => {
    git.detectRepo.mockResolvedValue('notesOnly')
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(git.fetchAndCompare).toHaveBeenCalledWith('/ws')
  })

  it('does not fetch when the workspace is not a git repository', async () => {
    git.detectRepo.mockResolvedValue(null)
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(git.fetchAndCompare).not.toHaveBeenCalled()
  })

  // #78: only worth asking while the one-time prompt is still unanswered on
  // this machine — a workspace that's already been prompted has no more use
  // for the "another machine already enabled this" wording.
  it('checks for prior git automation when a repo is detected and unprompted', async () => {
    git.detectRepo.mockResolvedValue('notesOnly')
    git.detectPriorAutomation.mockResolvedValue(true)
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(git.detectPriorAutomation).toHaveBeenCalledWith('/ws')
    expect(useWorkspaceStore.getState().gitPriorAutomation).toBe(true)
  })

  it('skips the prior-automation check once the prompt has already been answered', async () => {
    workspace.load.mockResolvedValue({ ...emptySession, git: { ...emptySession.git, prompted: true } })
    git.detectRepo.mockResolvedValue('notesOnly')
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(git.detectPriorAutomation).not.toHaveBeenCalled()
  })

  it('does not check for prior automation when there is no repo', async () => {
    git.detectRepo.mockResolvedValue(null)
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(git.detectPriorAutomation).not.toHaveBeenCalled()
  })

  it('saveSession persists the current git config alongside the rest of the session', async () => {
    useWorkspaceStore.setState({ path: '/ws', git: { prompted: true, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false } })
    const { result } = renderHook(() => useWorkspace())

    await result.current.saveSession()

    expect(workspace.save).toHaveBeenCalledWith(
      '/ws',
      expect.objectContaining({ git: { prompted: true, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false } }),
    )
  })

  it('closeWorkspace flushes the session, clears state, and falls back to the picker', async () => {
    useWorkspaceStore.setState({
      path: '/ws',
      openTabs: ['/ws/a.md'],
      activeTab: '/ws/a.md',
      expandedFolders: ['/ws/folder'],
    })
    useNotesStore.setState({
      notes: [{ id: '/ws/a.md', path: '/ws/a.md', title: 'a', workspace: '/ws', updatedAt: 0 }],
      folders: ['/ws/folder'],
    })
    const { result } = renderHook(() => useWorkspace())

    await result.current.closeWorkspace()

    expect(workspace.save).toHaveBeenCalledWith('/ws', expect.any(Object))
    expect(useWorkspaceStore.getState().path).toBeNull()
    expect(useWorkspaceStore.getState().openTabs).toEqual([])
    expect(useNotesStore.getState().notes).toEqual([])
    expect(useNotesStore.getState().folders).toEqual([])
  })

  // Regression for #76: closing/switching workspaces used to clear
  // gitPendingPaths via resetForNewWorkspace without ever committing them.
  it('closeWorkspace flushes a pending auto-commit batch before resetting', async () => {
    useWorkspaceStore.setState({
      path: '/ws',
      repoMode: 'notesOnly',
      git: { prompted: false, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: false, allowCodeRepoPush: false },
      gitPendingPaths: ['/ws/a.md'],
    })
    const { result } = renderHook(() => useWorkspace())

    await result.current.closeWorkspace()

    expect(git.autoCommit).toHaveBeenCalledWith('/ws', 'notesOnly', ['/ws/a.md'], false)
  })

  it('openWorkspaceAt flushes a pending auto-commit batch from the old workspace before switching', async () => {
    useWorkspaceStore.setState({
      path: '/old',
      repoMode: 'notesOnly',
      git: { prompted: false, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: false, allowCodeRepoPush: false },
      gitPendingPaths: ['/old/a.md'],
    })
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/new')

    expect(git.autoCommit).toHaveBeenCalledWith('/old', 'notesOnly', ['/old/a.md'], false)
  })

  it('saveSession persists secondaryTab and splitRatio alongside the rest of the session', async () => {
    useWorkspaceStore.setState({ path: '/ws', secondaryTab: '/ws/b.md', splitRatio: 0.4 })
    const { result } = renderHook(() => useWorkspace())

    await result.current.saveSession()

    expect(workspace.save).toHaveBeenCalledWith(
      '/ws',
      expect.objectContaining({ secondaryTab: '/ws/b.md', splitRatio: 0.4 }),
    )
  })

  it('openWorkspaceAt restores a saved split-pane layout into the store', async () => {
    workspace.load.mockResolvedValue({ ...emptySession, secondaryTab: '/ws/b.md', splitRatio: 0.4 })
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(useWorkspaceStore.getState().secondaryTab).toBe('/ws/b.md')
    expect(useWorkspaceStore.getState().splitRatio).toBe(0.4)
  })

  it('openWorkspaceAt defaults splitRatio to 0.5 for a session saved before split-pane editing shipped', async () => {
    workspace.load.mockResolvedValue(emptySession)
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
    expect(useWorkspaceStore.getState().splitRatio).toBe(0.5)
  })
})
