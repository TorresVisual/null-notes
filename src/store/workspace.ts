import { create } from 'zustand'
import { isUnderPath, replacePathPrefix } from '../lib/pathPrefix'
import type { GitWorkspaceConfig, RepoMode } from '../types'

const DEFAULT_GIT_CONFIG: GitWorkspaceConfig = { prompted: false, autoCommit: false }

interface FolderContextMenuState {
  path: string
  x: number
  y: number
}

interface WorkspaceStore {
  path: string | null
  openTabs: string[]
  activeTab: string | null
  expandedFolders: string[]
  selectedFolder: string | null
  folderContextMenu: FolderContextMenuState | null
  setPath: (path: string) => void
  openTab: (notePath: string) => void
  closeTab: (notePath: string) => void
  setActiveTab: (notePath: string) => void
  toggleFolder: (folderPath: string) => void
  setExpandedFolders: (paths: string[]) => void
  setSelectedFolder: (path: string | null) => void
  openFolderContextMenu: (path: string, x: number, y: number) => void
  closeFolderContextMenu: () => void
  replaceOpenPath: (oldPrefix: string, newPrefix: string) => void
  closeTabsUnder: (prefix: string) => void
  folderError: string | null
  setFolderError: (message: string | null) => void
  tagFilter: string | null
  setTagFilter: (tag: string | null) => void
  recentWorkspaces: string[]
  setRecentWorkspaces: (paths: string[]) => void
  resetForNewWorkspace: () => void
  // P5-1: which Git mode the open workspace is in (re-detected on every
  // open, never persisted — it's a fact about the disk, not a preference),
  // and the per-workspace, machine-local config that P5-1's one-time prompt
  // and its Settings toggle both read and write.
  repoMode: RepoMode | null
  setRepoMode: (mode: RepoMode | null) => void
  git: GitWorkspaceConfig
  setGit: (git: GitWorkspaceConfig) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  path: null,
  openTabs: [],
  activeTab: null,
  expandedFolders: [],
  selectedFolder: null,
  folderContextMenu: null,
  folderError: null,
  tagFilter: null,
  recentWorkspaces: [],
  repoMode: null,
  git: DEFAULT_GIT_CONFIG,

  setPath: (path) => set({ path, selectedFolder: path }),

  openTab: (notePath) => {
    const { openTabs } = get()
    if (openTabs.includes(notePath)) {
      set({ activeTab: notePath })
      return
    }
    set({ openTabs: [...openTabs, notePath], activeTab: notePath })
  },

  closeTab: (notePath) => {
    const { openTabs, activeTab } = get()
    const next = openTabs.filter((p) => p !== notePath)
    const newActive =
      activeTab === notePath ? (next[next.length - 1] ?? null) : activeTab
    set({ openTabs: next, activeTab: newActive })
  },

  setActiveTab: (notePath) => set({ activeTab: notePath }),

  toggleFolder: (folderPath) => {
    const { expandedFolders } = get()
    set({
      expandedFolders: expandedFolders.includes(folderPath)
        ? expandedFolders.filter((p) => p !== folderPath)
        : [...expandedFolders, folderPath],
    })
  },

  setExpandedFolders: (paths) => set({ expandedFolders: paths }),
  setSelectedFolder: (path) => set({ selectedFolder: path }),

  openFolderContextMenu: (path, x, y) => set({ folderContextMenu: { path, x, y } }),
  closeFolderContextMenu: () => set({ folderContextMenu: null }),

  replaceOpenPath: (oldPrefix, newPrefix) => {
    const { openTabs, activeTab } = get()
    set({
      openTabs: openTabs.map((p) => replacePathPrefix(p, oldPrefix, newPrefix)),
      activeTab: activeTab ? replacePathPrefix(activeTab, oldPrefix, newPrefix) : activeTab,
    })
  },

  closeTabsUnder: (prefix) => {
    const { openTabs, activeTab } = get()
    const next = openTabs.filter((p) => !isUnderPath(p, prefix))
    const newActive = activeTab && isUnderPath(activeTab, prefix) ? (next[next.length - 1] ?? null) : activeTab
    set({ openTabs: next, activeTab: newActive })
  },

  setFolderError: (message) => set({ folderError: message }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  setRecentWorkspaces: (paths) => set({ recentWorkspaces: paths }),
  setRepoMode: (mode) => set({ repoMode: mode }),
  setGit: (git) => set({ git }),

  resetForNewWorkspace: () =>
    set({
      openTabs: [],
      activeTab: null,
      expandedFolders: [],
      selectedFolder: null,
      folderContextMenu: null,
      folderError: null,
      tagFilter: null,
      repoMode: null,
      git: DEFAULT_GIT_CONFIG,
    }),
}))
