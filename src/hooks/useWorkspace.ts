import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useGitAutoPull } from './useGitAutoPull'

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

  const saveSession = useCallback(async () => {
    const { path, openTabs, activeTab, expandedFolders, git } = useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, { openTabs, activeTab, expandedFolders, git })
  }, [])

  // Read the folder before touching any state: a recent workspace can be gone
  // by the time it's clicked, and a failed scan must leave the current one open.
  const openWorkspaceAt = useCallback(
    async (selected: string, opts: { remember?: boolean } = {}) => {
      const { remember = true } = opts
      const { setFolderError, setRecentWorkspaces, setGit, setRepoMode } = useWorkspaceStore.getState()
      let tree, session
      try {
        ;[tree, session] = await Promise.all([
          api.notes.scan(selected),
          api.workspace.load(selected),
        ])
      } catch (e) {
        setFolderError(e instanceof Error ? e.message : String(e))
        return
      }

      await saveSession()
      resetForNewWorkspace()

      setPath(selected)
      await api.workspace.watch(selected)
      setNotes(tree.notes)
      setFolders(tree.folders)
      setExpandedFolders(session.expandedFolders)
      setGit(session.git)
      for (const tab of session.openTabs) {
        openTab(tab)
      }
      await refreshTags()
      if (remember) {
        setRecentWorkspaces(await api.workspace.remember(selected))
      }

      // Best-effort: a missing `git` binary or any other detection failure
      // just means no repo prompt, never a blocked workspace open.
      try {
        const mode = await api.git.detectRepo(selected)
        setRepoMode(mode)
        if (mode) await checkForUpdates(selected)
      } catch {
        setRepoMode(null)
      }
    },
    [setPath, setNotes, setFolders, setExpandedFolders, openTab, resetForNewWorkspace, saveSession, checkForUpdates],
  )

  const openWorkspace = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return
    await openWorkspaceAt(selected)
  }, [openWorkspaceAt])

  return { openWorkspace, openWorkspaceAt, saveSession }
}
