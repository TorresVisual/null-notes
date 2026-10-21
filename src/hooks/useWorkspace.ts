import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useGitAutoPull } from './useGitAutoPull'
import { useGitAutoCommit } from './useGitAutoCommit'
import { clearNavigationHistory } from '../lib/navigationHistory'

export async function refreshTree(): Promise<void> {
  const path = useWorkspaceStore.getState().path
  if (!path) return
  const tree = await api.notes.scan(path)
  useNotesStore.getState().setNotes(tree.notes)
  useNotesStore.getState().setFolders(tree.folders)
}

export async function refreshTags(): Promise<void> {
  const path = useWorkspaceStore.getState().path
  if (!path) return
  const tags = await api.notes.listTags(path)
  useNotesStore.getState().setTags(tags)
}

export async function refreshRecents(): Promise<void> {
  useWorkspaceStore.getState().setRecentWorkspaces(await api.workspace.recents())
}

export function useWorkspace() {
  const { setPath, openTab, setExpandedFolders, resetForNewWorkspace } = useWorkspaceStore()
  const { setNotes, setFolders } = useNotesStore()
  const { checkForUpdates } = useGitAutoPull()
  const { flushGitCommit } = useGitAutoCommit()

  const saveSession = useCallback(async () => {
    const {
      path,
      openTabs,
      activeTab,
      secondaryTab,
      splitRatio,
      sidebarCollapsed,
      tagsCollapsed,
      expandedFolders,
      recentSearches,
      git,
    } = useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, {
      openTabs,
      activeTab,
      secondaryTab,
      splitRatio,
      sidebarCollapsed,
      tagsCollapsed,
      expandedFolders,
      recentSearches,
      git,
    })
  }, [])

  const closeWorkspace = useCallback(async () => {
    await saveSession()
    await flushGitCommit()
    resetForNewWorkspace()
    clearNavigationHistory()
    setNotes([])
    setFolders([])
    setPath(null)
  }, [saveSession, flushGitCommit, resetForNewWorkspace, setNotes, setFolders, setPath])

  // Read the folder before touching any state: a recent workspace can be gone
  // by the time it's clicked, and a failed scan must leave the current one open.
  const openWorkspaceAt = useCallback(
    async (selected: string, opts: { remember?: boolean } = {}) => {
      const { remember = true } = opts
      const {
        setFolderError,
        setFolderLoading,
        setRecentWorkspaces,
        setRecentSearches,
        setGit,
        setRepoMode,
        setGitPriorAutomation,
        setSecondaryTab,
        setSplitRatio,
        setSidebarCollapsed,
        setTagsCollapsed,
      } = useWorkspaceStore.getState()
      setFolderLoading(true)
      let tree, session
      try {
        ;[tree, session] = await Promise.all([
          api.notes.scan(selected),
          api.workspace.load(selected),
        ])
      } catch (e) {
        setFolderError(e instanceof Error ? e.message : String(e))
        setFolderLoading(false)
        return
      }

      await saveSession()
      await flushGitCommit()
      resetForNewWorkspace()
      clearNavigationHistory()

      setPath(selected)
      await api.workspace.watch(selected)
      setNotes(tree.notes)
      setFolders(tree.folders)
      setExpandedFolders(session.expandedFolders)
      setRecentSearches(session.recentSearches)
      setGit(session.git)
      setSecondaryTab(session.secondaryTab ?? null)
      setSplitRatio(session.splitRatio ?? 0.5)
      setSidebarCollapsed(session.sidebarCollapsed ?? false)
      setTagsCollapsed(session.tagsCollapsed ?? false)
      for (const tab of session.openTabs) {
        openTab(tab)
      }
      await refreshTags()
      if (remember) {
        setRecentWorkspaces(await api.workspace.remember(selected))
      }
      setFolderLoading(false)

      // Best-effort and genuinely non-blocking: detached from the returned
      // promise so a slow/offline `git fetch` can't hold up callers (e.g.
      // Layout.tsx landing on a --select-file tab) behind network I/O that
      // has nothing to do with the workspace being ready to use.
      void (async () => {
        // Best-effort: a missing `git` binary or any other detection failure
        // just means no repo prompt, never a blocked workspace open.
        let mode = null
        try {
          mode = await api.git.detectRepo(selected)
          setRepoMode(mode)
          if (mode) await checkForUpdates(selected)
        } catch {
          setRepoMode(null)
        }

        // Only worth asking (#78) while the one-time prompt hasn't been
        // answered yet on this machine — same best-effort posture as
        // detection above, never blocks the open.
        let priorAutomation = false
        if (mode && !session.git.prompted) {
          try {
            priorAutomation = await api.git.detectPriorAutomation(selected)
          } catch {
            priorAutomation = false
          }
        }
        setGitPriorAutomation(priorAutomation)
      })()
    },
    [
      setPath,
      setNotes,
      setFolders,
      setExpandedFolders,
      openTab,
      resetForNewWorkspace,
      saveSession,
      flushGitCommit,
      checkForUpdates,
    ],
  )

  const openWorkspace = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return
    await openWorkspaceAt(selected)
  }, [openWorkspaceAt])

  return { openWorkspace, openWorkspaceAt, saveSession, closeWorkspace }
}
