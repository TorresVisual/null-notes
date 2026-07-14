import { useState } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import { refreshTree } from '../hooks/useWorkspace'
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
  const openFolderContextMenu = useWorkspaceStore((s) => s.openFolderContextMenu)
  const replaceOpenPath = useWorkspaceStore((s) => s.replaceOpenPath)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const removeNote = useNotesStore((s) => s.removeNote)

  if (entry.type === 'note') {
    const isActive = activeTab === entry.path

    async function handleDelete(e: React.MouseEvent) {
      e.stopPropagation()
      if (!confirm(`Delete "${entry.name}"?`)) return
      await api.notes.delete(entry.path)
      removeNote(entry.path)
      closeTab(entry.path)
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
          className="tree-delete"
          onClick={(e) => void handleDelete(e)}
          aria-label={`Delete ${entry.name}`}
        >
          ✕
        </button>
      </li>
    )
  }

  const isExpanded = expandedFolders.includes(entry.path)
  const isSelected = selectedFolder === entry.path

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const notePath = e.dataTransfer.getData('text/note-path')
    if (!notePath) return
    try {
      const newPath = await api.notes.moveNote(notePath, entry.path)
      replaceOpenPath(notePath, newPath)
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
        onClick={() => {
          toggleFolder(entry.path)
          setSelectedFolder(entry.path)
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
        <span className="tree-toggle">{isExpanded ? '▾' : '▸'}</span>
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
