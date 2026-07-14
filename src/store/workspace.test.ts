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
})
