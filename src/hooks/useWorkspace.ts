import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

export function useWorkspace() {
  const { setPath, openTab } = useWorkspaceStore()
  const { setNotes } = useNotesStore()

  const openWorkspace = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return

    setPath(selected)
    const [notes, session] = await Promise.all([
      api.notes.scan(selected),
      api.workspace.load(selected),
    ])
    setNotes(notes)
    for (const tab of session.openTabs) {
      openTab(tab)
    }
  }, [setPath, setNotes, openTab])

  const saveSession = useCallback(async () => {
    const { path, openTabs, activeTab } = useWorkspaceStore.getState()
    if (!path) return
    await api.workspace.save(path, { openTabs, activeTab })
  }, [])

  return { openWorkspace, saveSession }
}
