import { useCallback } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { refreshTree } from './useWorkspace'
import { api } from '../lib/tauri'

// Creates a folder under the selected folder (or workspace root), selects it
// and refreshes the tree. Shared by the sidebar button and the native menu.
export function useCreateFolder() {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)

  return useCallback(
    async (name: string): Promise<string | null> => {
      if (!workspacePath) return null
      const parent = selectedFolder ?? workspacePath
      try {
        const newPath = await api.notes.createFolder(parent, name)
        setSelectedFolder(newPath)
        setFolderError(null)
        await refreshTree()
        return newPath
      } catch (e) {
        setFolderError(e instanceof Error ? e.message : String(e))
        return null
      }
    },
    [workspacePath, selectedFolder, setSelectedFolder, setFolderError],
  )
}
