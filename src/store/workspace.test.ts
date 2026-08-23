import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from './workspace'

const reset = () =>
  useWorkspaceStore.setState({
    path: null,
    openTabs: [],
    activeTab: null,
    expandedFolders: [],
    selectedFolder: null,
    folderContextMenu: null,
    folderError: null,
    tagFilter: null,
    recentWorkspaces: [],
    recentSearches: [],
    repoMode: null,
    git: { prompted: false, autoCommit: false, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false },
    gitPendingPaths: [],
    gitCommitStatus: 'idle',
    gitDiverged: null,
  })

describe('useWorkspaceStore', () => {
  beforeEach(reset)

  it('opens a tab and makes it active', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    expect(useWorkspaceStore.getState().openTabs).toContain('/ws/a.md')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('does not duplicate tabs', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/a.md')
    expect(useWorkspaceStore.getState().openTabs.length).toBe(1)
  })

  it('closing the active tab activates the previous one', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().closeTab('/ws/b.md')
    expect(useWorkspaceStore.getState().openTabs).not.toContain('/ws/b.md')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('closing the only tab sets activeTab to null', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().closeTab('/ws/a.md')
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
  })

  it('setActiveTab accepts null to clear the active tab without closing any open tab', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().setActiveTab(null)
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md', '/ws/b.md'])
  })

  it('setPath defaults selectedFolder to the new path', () => {
    useWorkspaceStore.getState().setPath('/ws')
    expect(useWorkspaceStore.getState().selectedFolder).toBe('/ws')
  })

  it('toggleFolder adds then removes a folder from expandedFolders', () => {
    useWorkspaceStore.getState().toggleFolder('/ws/A')
    expect(useWorkspaceStore.getState().expandedFolders).toContain('/ws/A')
    useWorkspaceStore.getState().toggleFolder('/ws/A')
    expect(useWorkspaceStore.getState().expandedFolders).not.toContain('/ws/A')
  })

  it('replaceOpenPath rewrites tabs under the old prefix', () => {
    useWorkspaceStore.getState().openTab('/ws/Course1/a.md')
    useWorkspaceStore.getState().openTab('/ws/Course10/b.md')
    useWorkspaceStore.getState().replaceOpenPath('/ws/Course1', '/ws/Renamed')
    expect(useWorkspaceStore.getState().openTabs).toEqual([
      '/ws/Renamed/a.md',
      '/ws/Course10/b.md',
    ])
  })

  it('closeTabsUnder closes only tabs under the given prefix', () => {
    useWorkspaceStore.getState().openTab('/ws/Course1/a.md')
    useWorkspaceStore.getState().openTab('/ws/Course10/b.md')
    useWorkspaceStore.getState().closeTabsUnder('/ws/Course1')
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/Course10/b.md'])
  })

  it('opens and closes the folder context menu', () => {
    useWorkspaceStore.getState().openFolderContextMenu('/ws/A', 10, 20)
    expect(useWorkspaceStore.getState().folderContextMenu).toEqual({ path: '/ws/A', x: 10, y: 20 })
    useWorkspaceStore.getState().closeFolderContextMenu()
    expect(useWorkspaceStore.getState().folderContextMenu).toBeNull()
  })

  it('sets and clears the folder error message', () => {
    useWorkspaceStore.getState().setFolderError('a folder named X already exists')
    expect(useWorkspaceStore.getState().folderError).toBe('a folder named X already exists')
    useWorkspaceStore.getState().setFolderError(null)
    expect(useWorkspaceStore.getState().folderError).toBeNull()
  })

  it('sets and clears the tag filter', () => {
    useWorkspaceStore.getState().setTagFilter('cs101')
    expect(useWorkspaceStore.getState().tagFilter).toBe('cs101')
    useWorkspaceStore.getState().setTagFilter(null)
    expect(useWorkspaceStore.getState().tagFilter).toBeNull()
  })

  it('resetForNewWorkspace clears all per-workspace UI state', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().toggleFolder('/ws/A')
    useWorkspaceStore.getState().setSelectedFolder('/ws/A')
    useWorkspaceStore.getState().openFolderContextMenu('/ws/A', 10, 20)
    useWorkspaceStore.getState().setFolderError('some error')
    useWorkspaceStore.getState().setTagFilter('cs101')

    useWorkspaceStore.getState().resetForNewWorkspace()

    expect(useWorkspaceStore.getState().openTabs).toEqual([])
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
    expect(useWorkspaceStore.getState().expandedFolders).toEqual([])
    expect(useWorkspaceStore.getState().selectedFolder).toBeNull()
    expect(useWorkspaceStore.getState().folderContextMenu).toBeNull()
    expect(useWorkspaceStore.getState().folderError).toBeNull()
    expect(useWorkspaceStore.getState().tagFilter).toBeNull()
  })

  it('sets the recent workspaces list', () => {
    useWorkspaceStore.getState().setRecentWorkspaces(['/ws/a', '/ws/b'])
    expect(useWorkspaceStore.getState().recentWorkspaces).toEqual(['/ws/a', '/ws/b'])
  })

  it('addRecentSearch prepends, dedupes and caps the recent-searches list', () => {
    for (let i = 0; i < 9; i++) {
      useWorkspaceStore.getState().addRecentSearch(`query ${i}`)
    }
    useWorkspaceStore.getState().addRecentSearch('query 5')

    const searches = useWorkspaceStore.getState().recentSearches
    expect(searches[0]).toBe('query 5')
    expect(searches).toHaveLength(8)
    expect(searches.filter((q) => q === 'query 5')).toHaveLength(1)
  })

  it('addRecentSearch ignores a blank query', () => {
    useWorkspaceStore.getState().addRecentSearch('   ')
    expect(useWorkspaceStore.getState().recentSearches).toEqual([])
  })

  // Unlike the recent-workspaces list, recent searches are per-workspace
  // state loaded from that workspace's own session file.
  it('resetForNewWorkspace clears the recent searches list', () => {
    useWorkspaceStore.getState().addRecentSearch('theorem 3.2')
    useWorkspaceStore.getState().resetForNewWorkspace()
    expect(useWorkspaceStore.getState().recentSearches).toEqual([])
  })

  // The recent-workspaces list is global, not per-workspace UI state — it
  // must survive switching to a new workspace, unlike everything else here.
  it('resetForNewWorkspace does not clear the recent workspaces list', () => {
    useWorkspaceStore.getState().setRecentWorkspaces(['/ws/a'])
    useWorkspaceStore.getState().resetForNewWorkspace()
    expect(useWorkspaceStore.getState().recentWorkspaces).toEqual(['/ws/a'])
  })

  // P5-1: repo mode is re-detected on every open, never carried over from
  // whatever workspace was open before.
  it('sets and clears the detected repo mode', () => {
    useWorkspaceStore.getState().setRepoMode('notesOnly')
    expect(useWorkspaceStore.getState().repoMode).toBe('notesOnly')
    useWorkspaceStore.getState().setRepoMode(null)
    expect(useWorkspaceStore.getState().repoMode).toBeNull()
  })

  it('sets the per-workspace git config', () => {
    useWorkspaceStore.getState().setGit({ prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false })
    expect(useWorkspaceStore.getState().git).toEqual({ prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false })
  })

  it('resetForNewWorkspace clears the repo mode and git config back to their defaults', () => {
    useWorkspaceStore.getState().setRepoMode('codeRepo')
    useWorkspaceStore.getState().setGit({ prompted: true, autoCommit: true, idleMinutes: 10, skipHooks: false, autoPush: true, allowCodeRepoPush: false })

    useWorkspaceStore.getState().resetForNewWorkspace()

    expect(useWorkspaceStore.getState().repoMode).toBeNull()
    expect(useWorkspaceStore.getState().git).toEqual({
      prompted: false,
      autoCommit: false,
      idleMinutes: 10,
      skipHooks: false,
      autoPush: true, allowCodeRepoPush: false,
    })
  })

  it('addGitPendingPath dedupes', () => {
    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    useWorkspaceStore.getState().addGitPendingPath('/ws/b.md')
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/a.md', '/ws/b.md'])
  })

  it('clearGitPendingPaths empties the list', () => {
    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    useWorkspaceStore.getState().clearGitPendingPaths()
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual([])
  })
})
