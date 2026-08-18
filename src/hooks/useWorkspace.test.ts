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
    git: { detectRepo: vi.fn(), fetchAndCompare: vi.fn() },
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
  git: { prompted: false, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true },
}

describe('useWorkspace', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      path: null,
      openTabs: [],
      activeTab: null,
      expandedFolders: [],
      repoMode: null,
      git: { prompted: false, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true },
    })
    useNotesStore.setState({ notes: [], folders: [], tags: [] })
    notes.scan.mockResolvedValue(emptyTree)
    notes.listTags.mockResolvedValue([])
    workspace.load.mockResolvedValue(emptySession)
    workspace.save.mockResolvedValue(undefined)
    workspace.watch.mockResolvedValue(undefined)
    workspace.remember.mockResolvedValue([])
    git.detectRepo.mockResolvedValue(null)
    git.fetchAndCompare.mockResolvedValue({ kind: 'upToDate' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads the persisted git config into the store', async () => {
    workspace.load.mockResolvedValue({ ...emptySession, git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true } })
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws')

    expect(useWorkspaceStore.getState().git).toEqual({ prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true })
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

  it('saveSession persists the current git config alongside the rest of the session', async () => {
    useWorkspaceStore.setState({ path: '/ws', git: { prompted: true, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true } })
    const { result } = renderHook(() => useWorkspace())

    await result.current.saveSession()

    expect(workspace.save).toHaveBeenCalledWith(
      '/ws',
      expect.objectContaining({ git: { prompted: true, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true } }),
    )
  })
})
