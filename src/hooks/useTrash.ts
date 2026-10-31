import { api } from '../lib/tauri'
import { sidecarDir } from '../lib/pathPrefix'
import { useWorkspaceStore } from '../store/workspace'
import { showToast } from '../store/toast'
import type { TrashEntry } from '../types'
import { refreshTree } from './useWorkspace'

const SIDECAR_SUFFIXES = ['ink', 'pdf', 'diagrams', 'assets']

export async function restoreFromTrash(workspace: string, entry: TrashEntry): Promise<void> {
  const restoredPath = await api.trash.restore(workspace, entry.id)
  const { addGitPendingPath } = useWorkspaceStore.getState()
  for (const path of [entry.originalPath, restoredPath]) {
    addGitPendingPath(path)
    if (!entry.isFolder) {
      for (const suffix of SIDECAR_SUFFIXES) addGitPendingPath(sidecarDir(path, suffix))
    }
  }
  await refreshTree()
}

export function offerUndoDelete(workspace: string, entry: TrashEntry): void {
  showToast(`Deleted "${entry.name}"`, {
    label: 'Undo',
    onClick: () => {
      restoreFromTrash(workspace, entry).catch((err) =>
        showToast(err instanceof Error ? err.message : String(err)),
      )
    },
  })
}
