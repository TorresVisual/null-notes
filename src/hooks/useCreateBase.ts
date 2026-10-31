import { useCallback } from 'react'
import { api } from '../lib/tauri'
import { promptText } from '../store/promptDialog'
import { useWorkspaceStore } from '../store/workspace'
import { refreshTree } from './useWorkspace'

export function useCreateBase() {
  return useCallback(async (folder: string): Promise<void> => {
    const { path: workspace, setFolderError, expandFolder, openTab, addGitPendingPath } =
      useWorkspaceStore.getState()
    if (!workspace) return
    const name = await promptText('Base name:')
    if (!name) return
    try {
      const path = await api.base.create(workspace, folder, name)
      setFolderError(null)
      expandFolder(folder)
      addGitPendingPath(path)
      await refreshTree()
      openTab(path)
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }, [])
}
