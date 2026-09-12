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
  allowCodeRepoPush: false,
}

// A LIFO stack of just-closed note paths, capped the same way as recent
// searches — "reopen closed tab" needing to scroll past ten stale entries
// isn't a real workflow.
const CLOSED_TABS_CAP = 10

interface WorkspaceStore {
  path: string | null
  openTabs: string[]
  activeTab: string | null
  // Ephemeral, session-only — not part of WorkspaceState's saved fields
  // (openTabs/expandedFolders/etc.), the same posture as flashTabPath.
  // Only closeTab pushes here; closeTabsUnder (a folder deleted/renamed)
  // does not, since there's nothing to usefully "undo" back into.
  closedTabs: string[]
  expandedFolders: string[]
  selectedFolder: string | null
  setPath: (path: string | null) => void
  openTab: (notePath: string) => void
  closeTab: (notePath: string) => void
  reopenClosedTab: () => void
  setActiveTab: (notePath: string | null) => void
  reorderTabs: (fromPath: string, toPath: string) => void
  toggleFolder: (folderPath: string) => void
  expandFolder: (folderPath: string) => void
  setExpandedFolders: (paths: string[]) => void
  setSelectedFolder: (path: string | null) => void
  replaceOpenPath: (oldPrefix: string, newPrefix: string) => void
  closeTabsUnder: (prefix: string) => void
  folderError: string | null
  setFolderError: (message: string | null) => void
  folderLoading: boolean
  setFolderLoading: (loading: boolean) => void
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
  // #78: whether this workspace already has auto-commit history (remote +
  // a `notes:` commit) from another machine — read once per open, only to
  // change the one-time enable prompt's wording, never persisted.
  gitPriorAutomation: boolean
  setGitPriorAutomation: (detected: boolean) => void
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
  // A fast-forward-only pull refused because it would overwrite an
  // uncommitted local change — the working tree is untouched, but the
  // workspace is now silently behind the remote until this is resolved.
  gitPullBlocked: string | null
  setGitPullBlocked: (output: string | null) => void
  // #81: local commits that are ahead of the remote and never made it there
  // (a push failed offline/auth and nothing retried it since). Re-derived
  // from `checked_pull`'s ahead count on every checkForUpdates cycle, so —
  // unlike gitCommitStatus's transient 'pushFailed' chip — it survives an
  // app restart and clears itself once a retry actually lands.
  gitAhead: number | null
  setGitAhead: (ahead: number | null) => void
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
  closedTabs: [],
  expandedFolders: [],
  selectedFolder: null,
  folderError: null,
  folderLoading: false,
  tagFilter: null,
  recentWorkspaces: [],
  recentSearches: [],
  repoMode: null,
  git: DEFAULT_GIT_CONFIG,
  gitPriorAutomation: false,
  gitPendingPaths: [],
  gitCommitStatus: 'idle',
  gitCommitDetail: null,
  gitDiverged: null,
  gitPullBlocked: null,
  gitAhead: null,
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
    const { openTabs, activeTab, closedTabs } = get()
    const next = openTabs.filter((p) => p !== notePath)
    const newActive =
      activeTab === notePath ? (next[next.length - 1] ?? null) : activeTab
    const nextClosed = [...closedTabs, notePath].slice(-CLOSED_TABS_CAP)
    set({ openTabs: next, activeTab: newActive, closedTabs: nextClosed })
  },

  reopenClosedTab: () => {
    const { closedTabs } = get()
    const notePath = closedTabs[closedTabs.length - 1]
    if (!notePath) return
    set({ closedTabs: closedTabs.slice(0, -1) })
    get().openTab(notePath)
  },

  setActiveTab: (notePath) => set({ activeTab: notePath }),

  reorderTabs: (fromPath, toPath) => {
    if (fromPath === toPath) return
    const { openTabs } = get()
    const next = openTabs.filter((p) => p !== fromPath)
    const toIndex = next.indexOf(toPath)
    next.splice(toIndex, 0, fromPath)
    set({ openTabs: next })
  },

  toggleFolder: (folderPath) => {
    const { expandedFolders } = get()
    set({
      expandedFolders: expandedFolders.includes(folderPath)
        ? expandedFolders.filter((p) => p !== folderPath)
        : [...expandedFolders, folderPath],
    })
  },

  // Adds a folder to expandedFolders if it isn't already there — unlike
  // toggleFolder, never collapses. Used wherever a note or folder just
  // landed inside a folder (created or dropped into it) so it doesn't land
  // somewhere the user can't see without knowing to click the chevron.
  expandFolder: (folderPath) => {
    const { expandedFolders } = get()
    if (expandedFolders.includes(folderPath)) return
    set({ expandedFolders: [...expandedFolders, folderPath] })
  },
  setExpandedFolders: (paths) => set({ expandedFolders: paths }),
  setSelectedFolder: (path) => set({ selectedFolder: path }),

  replaceOpenPath: (oldPrefix, newPrefix) => {
    const { openTabs, activeTab, expandedFolders, selectedFolder } = get()
    set({
      openTabs: openTabs.map((p) => replacePathPrefix(p, oldPrefix, newPrefix)),
      activeTab: activeTab ? replacePathPrefix(activeTab, oldPrefix, newPrefix) : activeTab,
      expandedFolders: expandedFolders.map((p) => replacePathPrefix(p, oldPrefix, newPrefix)),
      selectedFolder: selectedFolder ? replacePathPrefix(selectedFolder, oldPrefix, newPrefix) : selectedFolder,
    })
  },

  closeTabsUnder: (prefix) => {
    const { openTabs, activeTab } = get()
    const next = openTabs.filter((p) => !isUnderPath(p, prefix))
    const newActive = activeTab && isUnderPath(activeTab, prefix) ? (next[next.length - 1] ?? null) : activeTab
    set({ openTabs: next, activeTab: newActive })
  },

  setFolderError: (message) => set({ folderError: message }),
  setFolderLoading: (loading) => set({ folderLoading: loading }),
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
  setGitPriorAutomation: (detected) => set({ gitPriorAutomation: detected }),

  addGitPendingPath: (path) => {
    const { gitPendingPaths } = get()
    if (gitPendingPaths.includes(path)) return
    set({ gitPendingPaths: [...gitPendingPaths, path] })
  },
  clearGitPendingPaths: () => set({ gitPendingPaths: [] }),
  setGitCommitStatus: (status) => set({ gitCommitStatus: status }),
  setGitCommitDetail: (detail) => set({ gitCommitDetail: detail }),
  setGitDiverged: (d) => set({ gitDiverged: d }),
  setGitPullBlocked: (output) => set({ gitPullBlocked: output }),
  setGitAhead: (ahead) => set({ gitAhead: ahead }),
  setFlashTabPath: (path) => set({ flashTabPath: path }),

  resetForNewWorkspace: () =>
    set({
      openTabs: [],
      activeTab: null,
      closedTabs: [],
      expandedFolders: [],
      selectedFolder: null,
      folderError: null,
      tagFilter: null,
      recentSearches: [],
      repoMode: null,
      git: DEFAULT_GIT_CONFIG,
      gitPriorAutomation: false,
      gitPendingPaths: [],
      gitCommitStatus: 'idle',
      gitCommitDetail: null,
      gitDiverged: null,
      gitPullBlocked: null,
      gitAhead: null,
      flashTabPath: null,
    }),
}))
