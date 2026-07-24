import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

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

export function useWorkspace() {
  const { setPath, openTab, setExpandedFolders, resetForNewWorkspace } = useWorkspaceStore()
  const { setNotes, setFolders } = useNotesStore()

  const saveSession = useCallback(async () => {
    const { path, openTabs, activeTab, expandedFolders } = useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, { openTabs, activeTab, expandedFolders })
  }, [])

  const openWorkspace = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return

    await saveSession()
    resetForNewWorkspace()

    setPath(selected)
    const [tree, session] = await Promise.all([
      api.notes.scan(selected),
      api.workspace.load(selected),
    ])
    setNotes(tree.notes)
    setFolders(tree.folders)
    setExpandedFolders(session.expandedFolders)
    for (const tab of session.openTabs) {
      openTab(tab)
    }
    await refreshTags()
  }, [setPath, setNotes, setFolders, setExpandedFolders, openTab, resetForNewWorkspace, saveSession])

  return { openWorkspace, saveSession }
}
