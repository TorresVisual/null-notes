import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from './workspace'

const reset = () =>
  useWorkspaceStore.setState({
    path: null,
    openTabs: [],
    pinnedTabs: [],
    activeTab: null,
    secondaryTab: null,
    splitRatio: 0.5,
    closedTabs: [],
    canvasViewports: {},
    expandedFolders: [],
    selectedFolder: null,
    folderError: null,
    folderLoading: false,
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

  describe('pinned tabs', () => {
    const open = (...paths: string[]) => paths.forEach((p) => useWorkspaceStore.getState().openTab(p))
    const state = () => useWorkspaceStore.getState()

    it('pinning moves the tab to the front; unpinning puts it after the pinned ones', () => {
      open('/ws/a.md', '/ws/b.md', '/ws/c.md')
      state().togglePinTab('/ws/c.md')
      expect(state().openTabs).toEqual(['/ws/c.md', '/ws/a.md', '/ws/b.md'])
      state().togglePinTab('/ws/b.md')
      expect(state().openTabs).toEqual(['/ws/c.md', '/ws/b.md', '/ws/a.md'])
      state().togglePinTab('/ws/c.md')
      expect(state().pinnedTabs).toEqual(['/ws/b.md'])
      expect(state().openTabs).toEqual(['/ws/b.md', '/ws/c.md', '/ws/a.md'])
    })

    it('a link opened from a pinned tab lands in a new tab; the pinned note stays', () => {
      open('/ws/ref.md')
      state().togglePinTab('/ws/ref.md')
      state().openTab('/ws/other.md')
      expect(state().openTabs).toEqual(['/ws/ref.md', '/ws/other.md'])
      expect(state().activeTab).toBe('/ws/other.md')
    })

    it('does not reorder across the pinned boundary', () => {
      open('/ws/a.md', '/ws/b.md')
      state().togglePinTab('/ws/a.md')
      state().reorderTabs('/ws/b.md', '/ws/a.md')
      expect(state().openTabs).toEqual(['/ws/a.md', '/ws/b.md'])
    })

    it('closing a tab drops its pin', () => {
      open('/ws/a.md')
      state().togglePinTab('/ws/a.md')
      state().closeTab('/ws/a.md')
      expect(state().pinnedTabs).toEqual([])
    })

    it('setPinnedTabs restores pins, ignoring tabs that are no longer open', () => {
      open('/ws/a.md', '/ws/b.md')
      state().setPinnedTabs(['/ws/b.md', '/ws/gone.md'])
      expect(state().pinnedTabs).toEqual(['/ws/b.md'])
      expect(state().openTabs).toEqual(['/ws/b.md', '/ws/a.md'])
    })

    it('follows a folder rename', () => {
      open('/ws/C1/a.md')
      state().togglePinTab('/ws/C1/a.md')
      state().replaceOpenPath('/ws/C1', '/ws/C2')
      expect(state().pinnedTabs).toEqual(['/ws/C2/a.md'])
    })
  })

  it('refuses to open a canvas in the secondary pane', () => {
    useWorkspaceStore.getState().setSecondaryTab('/ws/map.canvas')
    expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
    expect(useWorkspaceStore.getState().openTabs).not.toContain('/ws/map.canvas')
  })

  it('refuses to open a base in the secondary pane', () => {
    useWorkspaceStore.getState().setSecondaryTab('/ws/Tasks.base')
    expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
    expect(useWorkspaceStore.getState().openTabs).not.toContain('/ws/Tasks.base')
  })

  describe('canvas viewports', () => {
    const view = { x: 10, y: -20, zoom: 0.5 }

    it('remembers a viewport per canvas and restores a saved set', () => {
      useWorkspaceStore.getState().setCanvasViewport('/ws/a.canvas', view)
      expect(useWorkspaceStore.getState().canvasViewports).toEqual({ '/ws/a.canvas': view })
      useWorkspaceStore.getState().setCanvasViewports({ '/ws/b.canvas': view })
      expect(Object.keys(useWorkspaceStore.getState().canvasViewports)).toEqual(['/ws/b.canvas'])
    })

    it('follows a rename of the canvas or of its folder', () => {
      useWorkspaceStore.getState().setCanvasViewport('/ws/Notes/a.canvas', view)
      useWorkspaceStore.getState().replaceOpenPath('/ws/Notes/a.canvas', '/ws/Notes/b.canvas')
      useWorkspaceStore.getState().replaceOpenPath('/ws/Notes', '/ws/Course')
      expect(useWorkspaceStore.getState().canvasViewports).toEqual({ '/ws/Course/b.canvas': view })
    })

    it('is cleared for a new workspace', () => {
      useWorkspaceStore.getState().setCanvasViewport('/ws/a.canvas', view)
      useWorkspaceStore.getState().resetForNewWorkspace()
      expect(useWorkspaceStore.getState().canvasViewports).toEqual({})
    })
  })

  it('closing the only tab sets activeTab to null', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().closeTab('/ws/a.md')
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
  })

  it('closeTab pushes the closed path onto closedTabs', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().closeTab('/ws/a.md')
    expect(useWorkspaceStore.getState().closedTabs).toEqual(['/ws/a.md'])
  })

  it('reopenClosedTab reopens the most recently closed tab and removes it from the stack', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().closeTab('/ws/a.md')
    useWorkspaceStore.getState().closeTab('/ws/b.md')

    useWorkspaceStore.getState().reopenClosedTab()

    expect(useWorkspaceStore.getState().openTabs).toContain('/ws/b.md')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')
    expect(useWorkspaceStore.getState().closedTabs).toEqual(['/ws/a.md'])
  })

  it('reopenClosedTab is a no-op when nothing has been closed', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().reopenClosedTab()
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md'])
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('closedTabs is capped at 10 entries, dropping the oldest', () => {
    for (let i = 0; i < 11; i += 1) {
      useWorkspaceStore.getState().openTab(`/ws/${i}.md`)
      useWorkspaceStore.getState().closeTab(`/ws/${i}.md`)
    }
    const closed = useWorkspaceStore.getState().closedTabs
    expect(closed).toHaveLength(10)
    expect(closed).not.toContain('/ws/0.md')
    expect(closed[closed.length - 1]).toBe('/ws/10.md')
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

  it('expandFolder adds a folder to expandedFolders without toggling it closed again', () => {
    useWorkspaceStore.getState().expandFolder('/ws/A')
    expect(useWorkspaceStore.getState().expandedFolders).toEqual(['/ws/A'])
    useWorkspaceStore.getState().expandFolder('/ws/A')
    expect(useWorkspaceStore.getState().expandedFolders).toEqual(['/ws/A'])
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

  it('replaceOpenPath also rewrites expandedFolders and selectedFolder under the old prefix', () => {
    useWorkspaceStore.getState().toggleFolder('/ws/Course1')
    useWorkspaceStore.getState().toggleFolder('/ws/Course1/Sub')
    useWorkspaceStore.getState().toggleFolder('/ws/Course10')
    useWorkspaceStore.getState().setSelectedFolder('/ws/Course1')
    useWorkspaceStore.getState().replaceOpenPath('/ws/Course1', '/ws/Renamed')
    expect(useWorkspaceStore.getState().expandedFolders).toEqual([
      '/ws/Renamed',
      '/ws/Renamed/Sub',
      '/ws/Course10',
    ])
    expect(useWorkspaceStore.getState().selectedFolder).toBe('/ws/Renamed')
  })

  it('closeTabsUnder closes only tabs under the given prefix', () => {
    useWorkspaceStore.getState().openTab('/ws/Course1/a.md')
    useWorkspaceStore.getState().openTab('/ws/Course10/b.md')
    useWorkspaceStore.getState().closeTabsUnder('/ws/Course1')
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/Course10/b.md'])
  })

  it('reorderTabs moves a tab to sit before its drop target', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().openTab('/ws/c.md')
    useWorkspaceStore.getState().reorderTabs('/ws/c.md', '/ws/a.md')
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/c.md', '/ws/a.md', '/ws/b.md'])
  })

  it('reorderTabs is a no-op when dragged onto itself', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().reorderTabs('/ws/a.md', '/ws/a.md')
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md', '/ws/b.md'])
  })

  it('sets and clears the folder error message', () => {
    useWorkspaceStore.getState().setFolderError('a folder named X already exists')
    expect(useWorkspaceStore.getState().folderError).toBe('a folder named X already exists')
    useWorkspaceStore.getState().setFolderError(null)
    expect(useWorkspaceStore.getState().folderError).toBeNull()
  })

  it('setFolderLoading toggles the loading flag independently of folderError', () => {
    useWorkspaceStore.getState().setFolderLoading(true)
    expect(useWorkspaceStore.getState().folderLoading).toBe(true)
    expect(useWorkspaceStore.getState().folderError).toBeNull()

    useWorkspaceStore.getState().setFolderLoading(false)
    expect(useWorkspaceStore.getState().folderLoading).toBe(false)
  })

  it('sets and clears the tag filter', () => {
    useWorkspaceStore.getState().setTagFilter('cs101')
    expect(useWorkspaceStore.getState().tagFilter).toBe('cs101')
    useWorkspaceStore.getState().setTagFilter(null)
    expect(useWorkspaceStore.getState().tagFilter).toBeNull()
  })

  it('resetForNewWorkspace clears all per-workspace UI state', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().closeTab('/ws/a.md')
    useWorkspaceStore.getState().toggleFolder('/ws/A')
    useWorkspaceStore.getState().setSelectedFolder('/ws/A')
    useWorkspaceStore.getState().setFolderError('some error')
    useWorkspaceStore.getState().setTagFilter('cs101')

    useWorkspaceStore.getState().resetForNewWorkspace()

    expect(useWorkspaceStore.getState().openTabs).toEqual([])
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
    expect(useWorkspaceStore.getState().closedTabs).toEqual([])
    expect(useWorkspaceStore.getState().expandedFolders).toEqual([])
    expect(useWorkspaceStore.getState().selectedFolder).toBeNull()
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

  it('clearGitPendingPaths keeps paths queued after the committed batch was taken', () => {
    useWorkspaceStore.getState().addGitPendingPath('/ws/a.md')
    useWorkspaceStore.getState().addGitPendingPath('/ws/map.canvas')
    useWorkspaceStore.getState().clearGitPendingPaths(['/ws/a.md'])
    expect(useWorkspaceStore.getState().gitPendingPaths).toEqual(['/ws/map.canvas'])
  })

  it('setSecondaryTab opens a second pane on an already-open tab without changing activeTab', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().setSecondaryTab('/ws/a.md')
    expect(useWorkspaceStore.getState().secondaryTab).toBe('/ws/a.md')
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')
  })

  it('setSecondaryTab adds the path to openTabs if it was not already open', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().setSecondaryTab('/ws/c.md')
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md', '/ws/c.md'])
    expect(useWorkspaceStore.getState().secondaryTab).toBe('/ws/c.md')
  })

  it('setSecondaryTab accepts null to collapse back to single-pane', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().setSecondaryTab('/ws/a.md')
    useWorkspaceStore.getState().setSecondaryTab(null)
    expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md'])
  })

  it('closeTab clears secondaryTab when the closed path is the secondary pane', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().setSecondaryTab('/ws/b.md')
    useWorkspaceStore.getState().closeTab('/ws/b.md')
    expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
  })

  it('closeTabsUnder clears secondaryTab when it sits under the closed prefix', () => {
    useWorkspaceStore.getState().openTab('/ws/Course1/a.md')
    useWorkspaceStore.getState().openTab('/ws/Course10/b.md')
    useWorkspaceStore.getState().setSecondaryTab('/ws/Course1/a.md')
    useWorkspaceStore.getState().closeTabsUnder('/ws/Course1')
    expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
  })

  it('replaceOpenPath rewrites secondaryTab under the old prefix', () => {
    useWorkspaceStore.getState().openTab('/ws/Course1/a.md')
    useWorkspaceStore.getState().setSecondaryTab('/ws/Course1/a.md')
    useWorkspaceStore.getState().replaceOpenPath('/ws/Course1', '/ws/Renamed')
    expect(useWorkspaceStore.getState().secondaryTab).toBe('/ws/Renamed/a.md')
  })

  it('setSplitRatio stores the primary pane width fraction', () => {
    useWorkspaceStore.getState().setSplitRatio(0.35)
    expect(useWorkspaceStore.getState().splitRatio).toBe(0.35)
  })

  it('resetForNewWorkspace clears secondaryTab and splitRatio back to defaults', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().setSecondaryTab('/ws/a.md')
    useWorkspaceStore.getState().setSplitRatio(0.7)
    useWorkspaceStore.getState().resetForNewWorkspace()
    expect(useWorkspaceStore.getState().secondaryTab).toBeNull()
    expect(useWorkspaceStore.getState().splitRatio).toBe(0.5)
  })
})
