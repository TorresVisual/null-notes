import { useCallback } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { failure } from '../lib/failure'
import { folderName } from '../lib/pathPrefix'
import { useWorkspaceStore } from '../store/workspace'
import { showToast } from '../store/toast'
import { useWorkspace } from './useWorkspace'

export function useDeleteLocalWorkspace() {
  const { closeWorkspace } = useWorkspace()

  return useCallback(async () => {
    const path = useWorkspaceStore.getState().path
    if (!path) return
    const ok = await confirm(
      `Delete “${folderName(path)}” from this device? Anything not pushed to GitHub is lost. You can clone it again afterwards.`,
      { title: 'Delete local copy', kind: 'warning' },
    )
    if (!ok) return
    try {
      await closeWorkspace()
      useWorkspaceStore.getState().setRecentWorkspaces(await api.workspace.delete(path))
    } catch (e) {
      showToast(failure('delete the local copy', e))
    }
  }, [closeWorkspace])
}
