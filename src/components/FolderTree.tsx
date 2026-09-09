import { useState } from 'react'
import { TreeNode } from './TreeNode'
import { useWorkspaceStore } from '../store/workspace'
import { refreshTree } from '../hooks/useWorkspace'
import { folderName, isUnderPath, sidecarDir } from '../lib/pathPrefix'
import { api } from '../lib/tauri'
import type { TreeEntry } from '../lib/folderTree'

interface FolderTreeProps {
  entries: TreeEntry[]
  depth?: number
}

// This component only ever renders the root-level list — nested folders
// render their own children as a plain <ul> directly inside TreeNode, not
// through another FolderTree — so this list's own background (it fills the
// sidebar's full remaining height via `.sidebar > .folder-tree { flex: 1 }`,
// not just the height of its items) doubles as the "move back to root" drop
// target: a root-level folder's own onDrop already stops the event before it
// gets here, so only a drop that isn't already claimed by a folder — empty
// space, or a note row, which has no handler of its own — reaches this one.
export function FolderTree({ entries, depth = 0 }: FolderTreeProps) {
  const [dragOver, setDragOver] = useState(false)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const replaceOpenPath = useWorkspaceStore((s) => s.replaceOpenPath)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)

  async function handleDropAtRoot(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (!workspacePath) return
    const notePath = e.dataTransfer.getData('text/note-path')
    const draggedFolderPath = e.dataTransfer.getData('text/folder-path')
    try {
      if (notePath) {
        const newPath = await api.notes.moveNote(notePath, workspacePath)
        replaceOpenPath(notePath, newPath)
        for (const suffix of ['ink', 'pdf', 'diagrams', 'assets']) {
          useWorkspaceStore.getState().addGitPendingPath(sidecarDir(notePath, suffix))
          useWorkspaceStore.getState().addGitPendingPath(sidecarDir(newPath, suffix))
        }
        useWorkspaceStore.getState().addGitPendingPath(notePath)
        useWorkspaceStore.getState().addGitPendingPath(newPath)
      } else if (draggedFolderPath && !isUnderPath(workspacePath, draggedFolderPath)) {
        const separator = workspacePath.includes('\\') ? '\\' : '/'
        const newPath = `${workspacePath}${separator}${folderName(draggedFolderPath)}`
        await api.notes.renameFolder(draggedFolderPath, newPath)
        replaceOpenPath(draggedFolderPath, newPath)
        useWorkspaceStore.getState().addGitPendingPath(draggedFolderPath)
        useWorkspaceStore.getState().addGitPendingPath(newPath)
      } else {
        return
      }
      setFolderError(null)
      await refreshTree()
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <ul
      className={`folder-tree${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void handleDropAtRoot(e)}
      // Row clicks bubble up here too, but their target is the row, not this
      // <ul> — only a click that lands directly on the list's own empty
      // background (below the last item, since this fills the sidebar's
      // remaining height) should reselect root.
      onClick={(e) => {
        if (e.target === e.currentTarget && workspacePath) setSelectedFolder(workspacePath)
      }}
      // dragleave doesn't reliably fire for every child-boundary crossing as
      // the pointer moves around inside this list, which can leave `dragOver`
      // stuck true after a successful drop. dragend always fires exactly
      // once when the drag concludes (drop, cancel, or otherwise) and bubbles
      // through the dragged element's ancestors — which this list always is,
      // since every row in the tree lives somewhere inside it — so it's the
      // reliable point to force the indicator off regardless of what leave
      // events did or didn't fire along the way.
      onDragEnd={() => setDragOver(false)}
    >
      {entries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={depth} />
      ))}
    </ul>
  )
}
