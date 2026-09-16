import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitConfig } from './useGitConfig'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { workspace: { save: vi.fn() } },
}))

const workspace = vi.mocked(api.workspace)

describe('useGitConfig', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      path: '/ws',
      openTabs: ['/ws/a.md'],
      activeTab: '/ws/a.md',
      expandedFolders: [],
      git: { prompted: false, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
    })
    workspace.save.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('merges the patch into the store and persists the whole session', async () => {
    const { result } = renderHook(() => useGitConfig())

    await result.current.updateGit({ prompted: true, autoCommit: true })

    expect(useWorkspaceStore.getState().git).toEqual({
      prompted: true,
      autoCommit: true,
      idleMinutes: 10,
      skipHooks: false,
      autoPush: true, allowCodeRepoPush: false,
    })
    expect(workspace.save).toHaveBeenCalledWith('/ws', {
      openTabs: ['/ws/a.md'],
      activeTab: '/ws/a.md',
      secondaryTab: null,
      splitRatio: 0.5,
      expandedFolders: [],
      recentSearches: [],
      git: { prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
    })
  })

  // "Not now" only sets `prompted` — declining must not silently also flip
  // auto-commit on, which a naive full-object replace could do by accident.
  it('a partial patch leaves the other field untouched', async () => {
    useWorkspaceStore.setState({
      git: { prompted: false, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
    })
    const { result } = renderHook(() => useGitConfig())

    await result.current.updateGit({ prompted: true })

    expect(useWorkspaceStore.getState().git).toEqual({
      prompted: true,
      autoCommit: true,
      idleMinutes: 10,
      skipHooks: false,
      autoPush: true, allowCodeRepoPush: false,
    })
  })

  it('does nothing without an open workspace', async () => {
    useWorkspaceStore.setState({ path: null })
    const { result } = renderHook(() => useGitConfig())

    await result.current.updateGit({ prompted: true })

    expect(workspace.save).not.toHaveBeenCalled()
  })
})
