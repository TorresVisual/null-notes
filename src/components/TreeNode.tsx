import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import type { TreeEntry } from '../lib/folderTree'

interface TreeNodeProps {
  entry: TreeEntry
  depth: number
}

export function TreeNode({ entry, depth }: TreeNodeProps) {
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
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

  return (
    <li>
      <div
        className={`tree-row tree-folder${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          toggleFolder(entry.path)
          setSelectedFolder(entry.path)
        }}
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
