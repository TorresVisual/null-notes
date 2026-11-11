import { useState } from 'react'
import { Archive, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { deleteFolder, deleteNote, exportZip, moveNoteInto, moveSelectionInto, renameCanvas, renameFolder, renameNote } from '../lib/noteActions'
import { setDragChip } from '../lib/dragChip'
import { rangeSelection,toggleSelection } from '../lib/treeSelection'
import { refreshTree } from '../hooks/useWorkspace'
import { useCreateBase } from '../hooks/useCreateBase'
import { useCreateCanvas } from '../hooks/useCreateCanvas'
import { folderName, isUnderPath } from '../lib/pathPrefix'
import type { TreeEntry } from '../lib/folderTree'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu'
import { NoteContextMenuItems } from './NoteContextMenuItems'
import { BookmarkMenuItem } from './BookmarkMenuItem'

// Ignores keys that bubble up from the row's own rename/delete buttons.
function activateOnKey(e: React.KeyboardEvent, activate: () => void) {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
  e.preventDefault()
  activate()
}

const SELECTION_MIME = 'text/selection-paths'

interface TreeNodeProps {
  entry: TreeEntry
  visiblePaths?: string[]
}

export function TreeNode({ entry, visiblePaths = [] }: TreeNodeProps) {
  const [dragOver, setDragOver] = useState(false)
  const [dragging, setDragging] = useState(false)
  const selectedPaths = useWorkspaceStore((s) => s.selectedPaths)
  const inSelection = selectedPaths.includes(entry.path)

  // Returns true when the click was a selection gesture and the row should not
  // also open/toggle.
  function handleSelectionClick(e: React.MouseEvent): boolean {
    const { selectionAnchor, setSelection } = useWorkspaceStore.getState()
    if (e.shiftKey) {
      setSelection(rangeSelection(visiblePaths, selectionAnchor, entry.path), selectionAnchor ?? entry.path)
    } else if (e.ctrlKey || e.metaKey) {
      setSelection(toggleSelection(selectedPaths, entry.path), entry.path)
    } else {
      useWorkspaceStore.getState().clearSelection()
      return false
    }
    return true
  }

  function startDrag(e: React.DragEvent, mime: string) {
    e.dataTransfer.setData(mime, entry.path)
    const multi = inSelection && selectedPaths.length > 1
    if (multi) {
      e.dataTransfer.setData(SELECTION_MIME, JSON.stringify(selectedPaths))
    }
    setDragChip(e, entry.name, multi ? selectedPaths.length : 1)
    setDragging(true)
  }
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)
  const expandFolder = useWorkspaceStore((s) => s.expandFolder)
  const replaceOpenPath = useWorkspaceStore((s) => s.replaceOpenPath)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const createCanvas = useCreateCanvas()
  const createBase = useCreateBase()

  if (entry.type === 'canvas') {
    const isActive = activeTab === entry.path
    return (
      <li>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={`tree-row tree-note${isActive ? ' active' : ''}`}
              tabIndex={0}
              aria-current={isActive || undefined}
              onClick={() => openTab(entry.path)}
              onKeyDown={(e) => activateOnKey(e, () => openTab(entry.path))}
            >
              <span className="tree-label" title={entry.name}>{entry.name}</span>
              <button
                className="tree-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteNote(entry.path)
                }}
                aria-label={`Delete ${entry.name}`}
                title={`Delete ${entry.name}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="context-menu">
            <ContextMenuItem onSelect={() => void renameCanvas(entry.path)}>
              <Pencil size={14} /> Rename
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => void deleteNote(entry.path)}>
              <Trash2 size={14} /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </li>
    )
  }

  if (entry.type === 'note') {
    const isActive = activeTab === entry.path
    return (
      <li>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={`tree-row tree-note${isActive ? ' active' : ''}${inSelection ? ' multi-selected' : ''}${dragging ? ' dragging' : ''}`}
              draggable
              tabIndex={0}
              aria-current={isActive || undefined}
              aria-selected={inSelection || undefined}
              onDragStart={(e) => startDrag(e, 'text/note-path')}
              onDragEnd={() => setDragging(false)}
              onClick={(e) => {
                if (!handleSelectionClick(e)) openTab(entry.path)
              }}
              onKeyDown={(e) => activateOnKey(e, () => openTab(entry.path))}
            >
              <span className="tree-label" title={entry.name}>{entry.name}</span>
              <button
                className="tree-rename"
                onClick={(e) => {
                  e.stopPropagation()
                  void renameNote(entry.path)
                }}
                aria-label={`Rename ${entry.name}`}
                title={`Rename ${entry.name}`}
              >
                <Pencil size={12} />
              </button>
              <button
                className="tree-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteNote(entry.path)
                }}
                aria-label={`Delete ${entry.name}`}
                title={`Delete ${entry.name}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="context-menu">
            <NoteContextMenuItems path={entry.path} />
          </ContextMenuContent>
        </ContextMenu>
      </li>
    )
  }

  const isExpanded = expandedFolders.includes(entry.path)
  const isSelected = selectedFolder === entry.path

  function selectFolder() {
    toggleFolder(entry.path)
    setSelectedFolder(entry.path)
    setTagFilter(null)
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const notePath = e.dataTransfer.getData('text/note-path')
    const draggedFolderPath = e.dataTransfer.getData('text/folder-path')
    const selection = e.dataTransfer.getData(SELECTION_MIME)
    try {
      if (selection) {
        if (!workspacePath) return
        await moveSelectionInto(JSON.parse(selection) as string[], entry.path, workspacePath)
        expandFolder(entry.path)
        return
      }
      if (notePath) {
        if (!workspacePath) return
        await moveNoteInto(notePath, entry.path, workspacePath)
      } else if (draggedFolderPath && !isUnderPath(entry.path, draggedFolderPath)) {
        const separator = entry.path.includes('\\') ? '\\' : '/'
        const newPath = `${entry.path}${separator}${folderName(draggedFolderPath)}`
        await api.notes.renameFolder(draggedFolderPath, newPath)
        replaceOpenPath(draggedFolderPath, newPath)
        useWorkspaceStore.getState().addGitPendingPath(draggedFolderPath)
        useWorkspaceStore.getState().addGitPendingPath(newPath)
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`tree-row tree-folder${isSelected ? ' selected' : ''}${inSelection ? ' multi-selected' : ''}${dragOver ? ' drag-over' : ''}${dragging ? ' dragging' : ''}`}
            draggable
            role="button"
            tabIndex={0}
            aria-expanded={isExpanded}
            aria-selected={inSelection || undefined}
            onDragStart={(e) => startDrag(e, 'text/folder-path')}
            onDragEnd={() => setDragging(false)}
            onClick={(e) => {
              if (!handleSelectionClick(e)) selectFolder()
            }}
            onKeyDown={(e) => activateOnKey(e, selectFolder)}
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
            <span className="tree-label" title={entry.name}>{entry.name}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="context-menu">
          <BookmarkMenuItem bookmark={{ kind: 'folder', path: entry.path }} />
          <ContextMenuItem onSelect={() => void createCanvas(entry.path)}>
            <Plus size={14} /> New canvas
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void createBase(entry.path)}>
            <Plus size={14} /> New base
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void exportZip(entry.path)}>
            <Archive size={14} /> Export as zip…
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void renameFolder(entry.path, entry.name)}>
            <Pencil size={14} /> Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void deleteFolder(entry.path, entry.name)}>
            <Trash2 size={14} /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isExpanded && (
        <ul className="folder-tree tree-guide" style={{ marginLeft: 14 }}>
          {entry.children.map((child) => (
            <TreeNode key={child.path} entry={child} visiblePaths={visiblePaths} />
          ))}
        </ul>
      )}
    </li>
  )
}
