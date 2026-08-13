import { useCallback } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { refreshTree } from './useWorkspace'
import { api } from '../lib/tauri'

// Creates `notes/` and its four starter notes in a project workspace, on
// request only — this is reachable from the File menu and nowhere else, and
// nothing on the workspace-open path may ever call it. Writing into somebody's
// repository is not a thing to do on their behalf.
//
// Returns how many notes were actually created: running it on a repo that
// already keeps `notes/Todo.md` tops up the missing ones and leaves the real
// one alone, so "0" is a normal answer and not a failure.
export function useScaffoldProjectNotes() {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)

  return useCallback(
    async (): Promise<number | null> => {
      if (!workspacePath) return null
      try {
        const created = await api.notes.scaffoldProjectNotes(workspacePath)
        setFolderError(null)
        await refreshTree()
        return created.length
      } catch (e) {
        setFolderError(e instanceof Error ? e.message : String(e))
        return null
      }
    },
    [workspacePath, setFolderError],
  )
}
