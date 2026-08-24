import { useState } from 'react'
import { ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { promptText } from '../store/promptDialog'
import { api } from '../lib/tauri'
import { refreshTree } from '../hooks/useWorkspace'
import { folderName, isUnderPath } from '../lib/pathPrefix'
import type { TreeEntry } from '../lib/folderTree'

interface TreeNodeProps {
  entry: TreeEntry
  depth: number
}

export function TreeNode({ entry, depth }: TreeNodeProps) {
  const [dragOver, setDragOver] = useState(false)
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)
  const openFolderContextMenu = useWorkspaceStore((s) => s.openFolderContextMenu)
  const expandFolder = useWorkspaceStore((s) => s.expandFolder)
  const replaceOpenPath = useWorkspaceStore((s) => s.replaceOpenPath)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const removeNote = useNotesStore((s) => s.removeNote)

  if (entry.type === 'note') {
    const isActive = activeTab === entry.path
    const workspace = entry.note.workspace

    async function handleRename(e: React.MouseEvent) {
      e.stopPropagation()
      const newTitle = await promptText('New title:', entry.name)
      if (!newTitle || newTitle === entry.name) return
      try {
        await api.notes.rename(entry.path, newTitle, workspace)
        setFolderError(null)
        await refreshTree()
      } catch (err) {
        setFolderError(err instanceof Error ? err.message : String(err))
      }
    }

    async function handleDelete(e: React.MouseEvent) {
      e.stopPropagation()
      if (!(await confirm(`Delete "${entry.name}"?`))) return
      await api.notes.delete(entry.path)
      removeNote(entry.path)
      closeTab(entry.path)
      // Otherwise the deletion never enters the auto-commit's pathspec-scoped
      // pending list — the file is gone on disk, but `git rm` never runs, so
      // it silently never reaches the repo (or GitHub) at all.
      useWorkspaceStore.getState().addGitPendingPath(entry.path)
    }

    return (
      <li
        className={`tree-row tree-note${isActive ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/note-path', entry.path)}
        onClick={() => openTab(entry.path)}
      >
        <span className="tree-label">{entry.name}</span>
        <button
          className="tree-rename"
          onClick={(e) => void handleRename(e)}
          aria-label={`Rename ${entry.name}`}
          title={`Rename ${entry.name}`}
        >
          <Pencil size={12} />
        </button>
        <button
          className="tree-delete"
          onClick={(e) => void handleDelete(e)}
          aria-label={`Delete ${entry.name}`}
          title={`Delete ${entry.name}`}
        >
          <Trash2 size={12} />
        </button>
      </li>
    )
  }

  const isExpanded = expandedFolders.includes(entry.path)
  const isSelected = selectedFolder === entry.path

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const notePath = e.dataTransfer.getData('text/note-path')
    const draggedFolderPath = e.dataTransfer.getData('text/folder-path')
    try {
      if (notePath) {
        const newPath = await api.notes.moveNote(notePath, entry.path)
        replaceOpenPath(notePath, newPath)
      } else if (draggedFolderPath && !isUnderPath(entry.path, draggedFolderPath)) {
        const separator = entry.path.includes('\\') ? '\\' : '/'
        const newPath = `${entry.path}${separator}${folderName(draggedFolderPath)}`
        await api.notes.renameFolder(draggedFolderPath, newPath)
        replaceOpenPath(draggedFolderPath, newPath)
      } else {
        return
      }
      // Otherwise a drop into a collapsed folder leaves nothing on screen to
      // show it landed anywhere at all.
      expandFolder(entry.path)
      setFolderError(null)
      await refreshTree()
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <li>
      <div
        className={`tree-row tree-folder${isSelected ? ' selected' : ''}${dragOver ? ' drag-over' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/folder-path', entry.path)}
        onClick={() => {
          toggleFolder(entry.path)
          setSelectedFolder(entry.path)
          setTagFilter(null)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          openFolderContextMenu(entry.path, e.clientX, e.clientY)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => void handleDrop(e)}
      >
        <span className="tree-toggle">
          <ChevronRight size={12} className={`tree-toggle-icon${isExpanded ? ' open' : ''}`} />
        </span>
        <span className="tree-label">{entry.name}</span>
      </div>
      {isExpanded && (
        <ul className="folder-tree">
          {entry.children.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
