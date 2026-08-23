import { Pencil, Trash2 } from 'lucide-react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { promptText } from '../store/promptDialog'
import { api } from '../lib/tauri'
import { refreshTree } from '../hooks/useWorkspace'
import { isUnderPath } from '../lib/pathPrefix'

export function FolderContextMenu() {
  const menu = useWorkspaceStore((s) => s.folderContextMenu)
  const close = useWorkspaceStore((s) => s.closeFolderContextMenu)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const replaceOpenPath = useWorkspaceStore((s) => s.replaceOpenPath)
  const closeTabsUnder = useWorkspaceStore((s) => s.closeTabsUnder)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const notes = useNotesStore((s) => s.notes)

  if (!menu) return null

  const path = menu.path

  async function handleRename() {
    const currentName = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
    const name = await promptText('New folder name:', currentName)
    close()
    if (!name || name === currentName) return
    const newPath = path.replace(/[^/\\]+$/, name)
    try {
      await api.notes.renameFolder(path, newPath)
      replaceOpenPath(path, newPath)
      setFolderError(null)
      await refreshTree()
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDelete() {
    const count = notes.filter((n) => isUnderPath(n.path, path)).length
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
    close()
    const noun = count === 1 ? 'note' : 'notes'
    if (!(await confirm(`Delete "${name}" and its ${count} ${noun}? This cannot be undone.`))) return
    try {
      await api.notes.deleteFolder(path)
      closeTabsUnder(path)
      setSelectedFolder(null)
      setFolderError(null)
      // A directory pathspec stages every deletion under it in one shot —
      // no need to enumerate each note individually. Without this the whole
      // subtree's deletion never enters the auto-commit's pending list.
      useWorkspaceStore.getState().addGitPendingPath(path)
      await refreshTree()
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="context-menu-overlay" onMouseDown={close}>
      <div
        className="context-menu"
        style={{ position: 'fixed', top: menu.y, left: menu.x }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button onClick={() => void handleRename()}>
          <Pencil size={14} /> Rename
        </button>
        <button className="danger" onClick={() => void handleDelete()}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  )
}
