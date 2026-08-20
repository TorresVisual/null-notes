import { create } from 'zustand'
import { isUnderPath, replacePathPrefix } from '../lib/pathPrefix'
import type { GitWorkspaceConfig, RepoMode, GitCommitStatus } from '../types'

// Matches P1-2's recent-workspaces cap — a "recent list" this long is
// already more than a keyboard-driven picker needs to scroll through.
const RECENT_SEARCHES_CAP = 8

const DEFAULT_GIT_CONFIG: GitWorkspaceConfig = {
  prompted: false,
  autoCommit: false,
  idleMinutes: 10,
  skipHooks: false,
  autoPush: true,
}

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
  setActiveTab: (notePath: string | null) => void
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
  // P6-5: the search box's own recent-queries list, persisted per workspace
  // via WorkspaceState (same checkpoints as openTabs/expandedFolders — no
  // separate save path).
  recentSearches: string[]
  setRecentSearches: (queries: string[]) => void
  addRecentSearch: (query: string) => void
  resetForNewWorkspace: () => void
  // P5-1: which Git mode the open workspace is in (re-detected on every
  // open, never persisted — it's a fact about the disk, not a preference),
  // and the per-workspace, machine-local config that P5-1's one-time prompt
  // and its Settings toggle both read and write.
  repoMode: RepoMode | null
  setRepoMode: (mode: RepoMode | null) => void
  git: GitWorkspaceConfig
  setGit: (git: GitWorkspaceConfig) => void
  // P5-2: paths saved since the last auto-commit, deduplicated, in save
  // order — what the next batched commit will touch.
  gitPendingPaths: string[]
  addGitPendingPath: (path: string) => void
  clearGitPendingPaths: () => void
  gitCommitStatus: GitCommitStatus
  setGitCommitStatus: (status: GitCommitStatus) => void
  // The specific reason behind a 'skipped'/'error'/'pushFailed' status —
  // surfaced as a tooltip by GitCommitStatus rather than folded into the
  // badge's own short label, which stays a fixed, glanceable phrase.
  gitCommitDetail: string | null
  setGitCommitDetail: (detail: string | null) => void
  gitDiverged: { ahead: number; behind: number } | null
  setGitDiverged: (d: { ahead: number; behind: number } | null) => void
  // Ephemeral, UI-only: the tab that should show a brief "just created"
  // highlight. Never persisted — TabBar clears it itself once the CSS
  // animation finishes (see .tab-flash's onAnimationEnd).
  flashTabPath: string | null
  setFlashTabPath: (path: string | null) => void
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
  recentSearches: [],
  repoMode: null,
  git: DEFAULT_GIT_CONFIG,
  gitPendingPaths: [],
  gitCommitStatus: 'idle',
  gitCommitDetail: null,
  gitDiverged: null,
  flashTabPath: null,

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
  setRecentSearches: (queries) => set({ recentSearches: queries }),
  addRecentSearch: (query) => {
    const trimmed = query.trim()
    if (!trimmed) return
    const { recentSearches } = get()
    const deduped = recentSearches.filter((q) => q !== trimmed)
    set({ recentSearches: [trimmed, ...deduped].slice(0, RECENT_SEARCHES_CAP) })
  },
  setRepoMode: (mode) => set({ repoMode: mode }),
  setGit: (git) => set({ git }),

  addGitPendingPath: (path) => {
    const { gitPendingPaths } = get()
    if (gitPendingPaths.includes(path)) return
    set({ gitPendingPaths: [...gitPendingPaths, path] })
  },
  clearGitPendingPaths: () => set({ gitPendingPaths: [] }),
  setGitCommitStatus: (status) => set({ gitCommitStatus: status }),
  setGitCommitDetail: (detail) => set({ gitCommitDetail: detail }),
  setGitDiverged: (d) => set({ gitDiverged: d }),
  setFlashTabPath: (path) => set({ flashTabPath: path }),

  resetForNewWorkspace: () =>
    set({
      openTabs: [],
      activeTab: null,
      expandedFolders: [],
      selectedFolder: null,
      folderContextMenu: null,
      folderError: null,
      tagFilter: null,
      recentSearches: [],
      repoMode: null,
      git: DEFAULT_GIT_CONFIG,
      gitPendingPaths: [],
      gitCommitStatus: 'idle',
      gitCommitDetail: null,
      gitDiverged: null,
      flashTabPath: null,
    }),
}))
