import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useBookmarksStore } from '../store/bookmarks'
import { refreshTree, refreshTags } from './useWorkspace'

// Files are the source of truth, so anything that edits them — another editor,
// a git pull, a sync client — has to be able to move the index and the tree.
export function useExternalChanges() {
  const workspace = useWorkspaceStore((s) => s.path)

  useEffect(() => {
    if (workspace) void useBookmarksStore.getState().load(workspace)
  }, [workspace])

  useEffect(() => {
    const unlisten = listen('bookmarks-changed', () => void useBookmarksStore.getState().reload())
    return () => void unlisten.then((off) => off())
  }, [])

  useEffect(() => {
    const unlisten = listen('canvas-changed', () => void refreshTree())
    return () => void unlisten.then((off) => off())
  }, [])

  useEffect(() => {
    const unlisten = listen<string[]>('workspace-changed', async (event) => {
      const workspace = useWorkspaceStore.getState().path
      if (!workspace) return
      await Promise.all(
        event.payload.map((path) => api.notes.reindexFromDisk(path, workspace)),
      )
      await refreshTree()
      await refreshTags()
    })
    return () => void unlisten.then((off) => off())
  }, [])
}
