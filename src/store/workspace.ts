import { create } from 'zustand'
import { replacePathPrefix } from '../lib/pathPrefix'
import {
  closeGroup,
  closeTabIn,
  initialLayout,
  moveTab,
  openIn,
  openPaths,
  pinToggle,
  reorderIn,
  removeUnder,
  replacePrefixAll,
  setFocused,
  setRatio,
  setViewMode,
  splitActive,
  toggleDirection,
  type GroupLayout,
  type SplitSide,
  type ViewMode,
} from '../lib/editorGroups'
import { useBookmarksStore } from './bookmarks'
import type { CanvasViewport, GitWorkspaceConfig, RepoMode, GitCommitStatus, SearchSort } from '../types'

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

const pinnedFirst = (tabs: string[], pinned: string[]) => [
  ...tabs.filter((p) => pinned.includes(p)),
  ...tabs.filter((p) => !pinned.includes(p)),
]

// openTabs/pinnedTabs/activeTab mirror the focused group so the many callers
// that predate editor groups keep working; commit() is the only writer.
const project = (layout: GroupLayout) => {
  const g = layout.groups[layout.focused]
  return { layout, openTabs: g?.tabs ?? [], pinnedTabs: g?.pinned ?? [], activeTab: g?.active ?? null }
}

const withActive = (layout: GroupLayout, group: number, path: string | null): GroupLayout => ({
  ...layout,
  groups: layout.groups.map((g, i) => (i === group ? { ...g, active: path } : g)),
})

interface WorkspaceStore {
  path: string | null
  layout: GroupLayout
  splitEditor: (side: SplitSide) => void
  moveTabToGroup: (notePath: string, to: number, copy: boolean) => void
  focusGroup: (group: number) => void
  focusNextGroup: () => void
  focusPrevGroup: () => void
  closeEditorGroup: () => void
  toggleSplitDirection: () => void
  resetSplitRatio: () => void
  setGroupViewMode: (group: number, mode: ViewMode) => void
  activateTabIn: (notePath: string, group: number) => void
  closeTabInGroup: (notePath: string, group: number) => void
  // Mirror of the focused group. Invariant: pinnedTabs ⊆ openTabs, and pinned
  // tabs are a prefix of openTabs, so tab order (and Ctrl+1..9) is just
  // openTabs order.
  openTabs: string[]
  pinnedTabs: string[]
  togglePinTab: (notePath: string) => void
  setPinnedTabs: (paths: string[]) => void
  activeTab: string | null
  setSplitRatio: (ratio: number) => void
  // Sidebar rail+panel UI state, persisted per workspace via WorkspaceState.
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  tagsCollapsed: boolean
  toggleTags: () => void
  setTagsCollapsed: (collapsed: boolean) => void
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
  // Ephemeral multi-select in the sidebar tree: never persisted.
  selectedPaths: string[]
  selectionAnchor: string | null
  setSelection: (paths: string[], anchor: string | null) => void
  clearSelection: () => void
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
  // Last pan/zoom per canvas, persisted per workspace like recentSearches.
  canvasViewports: Record<string, CanvasViewport>
  setCanvasViewport: (path: string, viewport: CanvasViewport) => void
  setCanvasViewports: (viewports: Record<string, CanvasViewport>) => void
  recentSearches: string[]
  setRecentSearches: (queries: string[]) => void
  addRecentSearch: (query: string) => void
  // Session-only: the Ctrl+K sort choice outlives the modal, not the app.
  searchSort: SearchSort
  setSearchSort: (sort: SearchSort) => void
  resetForNewWorkspace: () => void
  // P5-1: which Git mode the open workspace is in (re-detected on every
  // open, never persisted — it's a fact about the disk, not a preference),
  // and the per-workspace, machine-local config that P5-1's one-time prompt
  // and its Settings toggle both read and write.
  repoMode: RepoMode | null
  singleNote: boolean
  setRepoMode: (mode: RepoMode | null) => void
  setSingleNote: (singleNote: boolean) => void
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
  clearGitPendingPaths: (committed?: string[]) => void
  gitCommitStatus: GitCommitStatus
  setGitCommitStatus: (status: GitCommitStatus) => void
  // The specific reason behind a 'skipped'/'error'/'pushFailed' status —
  // surfaced as a tooltip by GitCommitStatus rather than folded into the
  // badge's own short label, which stays a fixed, glanceable phrase.
  gitCommitDetail: string | null
  setGitCommitDetail: (detail: string | null) => void
  gitDiverged: { ahead: number; behind: number; localPaths: string[]; remotePaths: string[] } | null
  setGitDiverged: (
    d: { ahead: number; behind: number; localPaths: string[]; remotePaths: string[] } | null,
  ) => void
  // A fast-forward-only pull refused because it would overwrite an
  // uncommitted local change — the working tree is untouched, but the
  // workspace is now silently behind the remote until this is resolved.
  gitPullBlocked: { output: string; paths: string[] } | null
  setGitPullBlocked: (blocked: { output: string; paths: string[] } | null) => void
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

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  const commit = (layout: GroupLayout, extra: Partial<WorkspaceStore> = {}) =>
    set({ ...project(layout), ...extra })

  const closeIn = (notePath: string, group: number) => {
    const { layout, closedTabs } = get()
    const next = closeTabIn(layout, notePath, group)
    commit(
      next,
      openPaths(next).includes(notePath)
        ? {}
        : { closedTabs: [...closedTabs, notePath].slice(-CLOSED_TABS_CAP) },
    )
  }

  const stepFocus = (step: number) => {
    const { layout } = get()
    const n = layout.groups.length
    if (n > 1) commit(setFocused(layout, (layout.focused + step + n) % n))
  }

  return {
  path: null,
  ...project(initialLayout()),
  canvasViewports: {},
  sidebarCollapsed: false,
  tagsCollapsed: false,
  closedTabs: [],
  expandedFolders: [],
  selectedFolder: null,
  selectedPaths: [],
  selectionAnchor: null,
  folderError: null,
  folderLoading: false,
  tagFilter: null,
  recentWorkspaces: [],
  recentSearches: [],
  searchSort: 'relevance',
  repoMode: null,
  singleNote: false,
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

  openTab: (notePath) => commit(openIn(get().layout, notePath)),

  closeTab: (notePath) => closeIn(notePath, get().layout.focused),

  closeTabInGroup: closeIn,

  splitEditor: (side) => commit(splitActive(get().layout, side)),

  moveTabToGroup: (notePath, to, copy) =>
    commit(moveTab(get().layout, notePath, to === 0 ? 1 : 0, to, copy)),

  focusGroup: (group) => commit(setFocused(get().layout, group)),
  focusNextGroup: () => stepFocus(1),
  focusPrevGroup: () => stepFocus(-1),

  closeEditorGroup: () => {
    const { layout, closedTabs } = get()
    const closed = closeGroup(layout, layout.focused)
    if (closed.layout === layout) return
    commit(closed.layout, { closedTabs: [...closedTabs, ...closed.dropped].slice(-CLOSED_TABS_CAP) })
  },

  toggleSplitDirection: () => commit(toggleDirection(get().layout)),
  resetSplitRatio: () => commit(setRatio(get().layout, 0.5)),
  setGroupViewMode: (group, mode) => commit(setViewMode(get().layout, group, mode)),

  activateTabIn: (notePath, group) => {
    const { layout } = get()
    if (layout.groups[group]) commit(withActive(setFocused(layout, group), group, notePath))
  },

  reopenClosedTab: () => {
    const { closedTabs } = get()
    const notePath = closedTabs[closedTabs.length - 1]
    if (!notePath) return
    set({ closedTabs: closedTabs.slice(0, -1) })
    get().openTab(notePath)
  },

  setActiveTab: (notePath) => {
    const { layout } = get()
    commit(withActive(layout, layout.focused, notePath))
  },

  setSplitRatio: (ratio) => commit(setRatio(get().layout, ratio)),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleTags: () => set((s) => ({ tagsCollapsed: !s.tagsCollapsed })),
  setTagsCollapsed: (collapsed) => set({ tagsCollapsed: collapsed }),

  togglePinTab: (notePath) => {
    const { layout } = get()
    commit(pinToggle(layout, notePath, layout.focused))
  },

  setPinnedTabs: (paths) => {
    const { layout, openTabs } = get()
    const pinned = paths.filter((p) => openTabs.includes(p))
    commit({
      ...layout,
      groups: layout.groups.map((g, i) =>
        i === layout.focused ? { ...g, pinned, tabs: pinnedFirst(g.tabs, pinned) } : g,
      ),
    })
  },

  reorderTabs: (fromPath, toPath) => {
    const { layout } = get()
    commit(reorderIn(layout, fromPath, toPath, layout.focused))
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
  setCanvasViewport: (path, viewport) =>
    set({ canvasViewports: { ...get().canvasViewports, [path]: viewport } }),
  setCanvasViewports: (viewports) => set({ canvasViewports: viewports }),
  setExpandedFolders: (paths) => set({ expandedFolders: paths }),
  setSelectedFolder: (path) => set({ selectedFolder: path }),
  setSelection: (paths, anchor) => set({ selectedPaths: paths, selectionAnchor: anchor }),
  clearSelection: () => set({ selectedPaths: [], selectionAnchor: null }),

  replaceOpenPath: (oldPrefix, newPrefix) => {
    useBookmarksStore.getState().rewritePrefix(oldPrefix, newPrefix)
    const { layout, expandedFolders, selectedFolder, canvasViewports } = get()
    commit(replacePrefixAll(layout, oldPrefix, newPrefix), {
      canvasViewports: Object.fromEntries(
        Object.entries(canvasViewports).map(([p, v]) => [replacePathPrefix(p, oldPrefix, newPrefix), v]),
      ),
      expandedFolders: expandedFolders.map((p) => replacePathPrefix(p, oldPrefix, newPrefix)),
      selectedFolder: selectedFolder ? replacePathPrefix(selectedFolder, oldPrefix, newPrefix) : selectedFolder,
    })
  },

  closeTabsUnder: (prefix) => commit(removeUnder(get().layout, prefix)),

  setFolderError: (message) => set({ folderError: message }),
  setFolderLoading: (loading) => set({ folderLoading: loading }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  setRecentWorkspaces: (paths) => set({ recentWorkspaces: paths }),
  setRecentSearches: (queries) => set({ recentSearches: queries }),
  setSearchSort: (sort) => set({ searchSort: sort }),
  addRecentSearch: (query) => {
    const trimmed = query.trim()
    if (!trimmed) return
    const { recentSearches } = get()
    const deduped = recentSearches.filter((q) => q !== trimmed)
    set({ recentSearches: [trimmed, ...deduped].slice(0, RECENT_SEARCHES_CAP) })
  },
  setRepoMode: (mode) => set({ repoMode: mode }),
  setSingleNote: (singleNote) => set({ singleNote }),
  setGit: (git) => set({ git }),
  setGitPriorAutomation: (detected) => set({ gitPriorAutomation: detected }),

  addGitPendingPath: (path) => {
    const { gitPendingPaths } = get()
    if (gitPendingPaths.includes(path)) return
    set({ gitPendingPaths: [...gitPendingPaths, path] })
  },
  // Only the batch that was committed: a path queued while the commit ran must
  // survive, or its change waits for the next relaunch's "Sync now".
  clearGitPendingPaths: (committed) =>
    set({
      gitPendingPaths: committed ? get().gitPendingPaths.filter((p) => !committed.includes(p)) : [],
    }),
  setGitCommitStatus: (status) => set({ gitCommitStatus: status }),
  setGitCommitDetail: (detail) => set({ gitCommitDetail: detail }),
  setGitDiverged: (d) => set({ gitDiverged: d }),
  setGitPullBlocked: (blocked) => set({ gitPullBlocked: blocked }),
  setGitAhead: (ahead) => set({ gitAhead: ahead }),
  setFlashTabPath: (path) => set({ flashTabPath: path }),

  resetForNewWorkspace: () =>
    commit(initialLayout(), {
      canvasViewports: {},
      sidebarCollapsed: false,
      tagsCollapsed: false,
      closedTabs: [],
      expandedFolders: [],
      selectedFolder: null,
      selectedPaths: [],
      selectionAnchor: null,
      folderError: null,
      tagFilter: null,
      recentSearches: [],
      repoMode: null,
      singleNote: false,
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
  }
})

// Code that seeds or edits openTabs/pinnedTabs/activeTab directly (tests, older
// call sites) is folded into the focused group, so the layout never goes stale.
useWorkspaceStore.subscribe((s, prev) => {
  if (s.openTabs === prev.openTabs && s.pinnedTabs === prev.pinnedTabs && s.activeTab === prev.activeTab) return
  const g = s.layout.groups[s.layout.focused]
  if (!g || (g.tabs === s.openTabs && g.pinned === s.pinnedTabs && g.active === s.activeTab)) return
  useWorkspaceStore.setState({
    layout: {
      ...s.layout,
      groups: s.layout.groups.map((x, i) =>
        i === s.layout.focused ? { ...x, tabs: s.openTabs, pinned: s.pinnedTabs, active: s.activeTab } : x,
      ),
    },
  })
})
