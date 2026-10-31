import { useState } from 'react'
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { offerUndoDelete } from '../hooks/useTrash'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { promptText } from '../store/promptDialog'
import { api } from '../lib/tauri'
import { deleteNote, moveNoteInto, renameCanvas, renameNote } from '../lib/noteActions'
import { refreshTree } from '../hooks/useWorkspace'
import { useCreateBase } from '../hooks/useCreateBase'
import { useCreateCanvas } from '../hooks/useCreateCanvas'
import { folderName, isSingleSegmentName, isUnderPath } from '../lib/pathPrefix'
import type { TreeEntry } from '../lib/folderTree'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu'
import { NoteContextMenuItems } from './NoteContextMenuItems'
import { BookmarkMenuItem } from './BookmarkMenuItem'

// Ignores keys that bubble up from the row's own rename/delete buttons.
function activateOnKey(e: React.KeyboardEvent, activate: () => void) {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
  e.preventDefault()
  activate()
}

interface TreeNodeProps {
  entry: TreeEntry
}

export function TreeNode({ entry }: TreeNodeProps) {
  const [dragOver, setDragOver] = useState(false)
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)
  const expandFolder = useWorkspaceStore((s) => s.expandFolder)
  const replaceOpenPath = useWorkspaceStore((s) => s.replaceOpenPath)
  const closeTabsUnder = useWorkspaceStore((s) => s.closeTabsUnder)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const notes = useNotesStore((s) => s.notes)
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
              className={`tree-row tree-note${isActive ? ' active' : ''}`}
              draggable
              tabIndex={0}
              aria-current={isActive || undefined}
              onDragStart={(e) => e.dataTransfer.setData('text/note-path', entry.path)}
              onClick={() => openTab(entry.path)}
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
    try {
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

  async function handleRenameFolder() {
    const name = await promptText('New folder name:', entry.name)
    if (!name || name === entry.name) return
    if (!isSingleSegmentName(name)) {
      setFolderError('A folder name cannot contain / or \\.')
      return
    }
    const newPath = entry.path.replace(/[^/\\]+$/, name)
    try {
      await api.notes.renameFolder(entry.path, newPath)
      replaceOpenPath(entry.path, newPath)
      setFolderError(null)
      useWorkspaceStore.getState().addGitPendingPath(entry.path)
      useWorkspaceStore.getState().addGitPendingPath(newPath)
      await refreshTree()
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDeleteFolder() {
    if (!workspacePath) return
    const count = notes.filter((n) => isUnderPath(n.path, entry.path)).length
    const noun = count === 1 ? 'note' : 'notes'
    if (!(await confirm(`Delete "${entry.name}" and its ${count} ${noun}? You can restore it from Trash.`))) return
    try {
      const trashed = await api.notes.deleteFolder(workspacePath, entry.path)
      closeTabsUnder(entry.path)
      setSelectedFolder(null)
      setFolderError(null)
      // A directory pathspec stages every deletion under it in one shot —
      // no need to enumerate each note individually. Without this the whole
      // subtree's deletion never enters the auto-commit's pending list.
      useWorkspaceStore.getState().addGitPendingPath(entry.path)
      offerUndoDelete(workspacePath, trashed)
      await refreshTree()
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`tree-row tree-folder${isSelected ? ' selected' : ''}${dragOver ? ' drag-over' : ''}`}
            draggable
            role="button"
            tabIndex={0}
            aria-expanded={isExpanded}
            onDragStart={(e) => e.dataTransfer.setData('text/folder-path', entry.path)}
            onClick={selectFolder}
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
          <ContextMenuItem onSelect={() => void handleRenameFolder()}>
            <Pencil size={14} /> Rename
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => void handleDeleteFolder()}>
            <Trash2 size={14} /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isExpanded && (
        <ul className="folder-tree tree-guide" style={{ marginLeft: 14 }}>
          {entry.children.map((child) => (
            <TreeNode key={child.path} entry={child} />
          ))}
        </ul>
      )}
    </li>
  )
}
