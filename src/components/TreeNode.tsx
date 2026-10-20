import { useState } from 'react'
import { ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { promptText } from '../store/promptDialog'
import { api } from '../lib/tauri'
import { refreshTree } from '../hooks/useWorkspace'
import { folderName, isSingleSegmentName, isUnderPath, sidecarDir } from '../lib/pathPrefix'
import type { TreeEntry } from '../lib/folderTree'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu'

// Ignores keys that bubble up from the row's own rename/delete buttons.
function activateOnKey(e: React.KeyboardEvent, activate: () => void) {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
  e.preventDefault()
  activate()
}

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
  const expandFolder = useWorkspaceStore((s) => s.expandFolder)
  const replaceOpenPath = useWorkspaceStore((s) => s.replaceOpenPath)
  const closeTabsUnder = useWorkspaceStore((s) => s.closeTabsUnder)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const notes = useNotesStore((s) => s.notes)
  const removeNote = useNotesStore((s) => s.removeNote)

  if (entry.type === 'note') {
    const isActive = activeTab === entry.path
    const workspace = entry.note.workspace

    async function handleRename(e: React.MouseEvent) {
      e.stopPropagation()
      const newTitle = await promptText('New title:', entry.name)
      if (!newTitle || newTitle === entry.name) return
      try {
        const renamed = await api.notes.rename(entry.path, newTitle, workspace)
        setFolderError(null)
        // rename_note moves the file (and its sidecars) to match the new
        // title, the same way a drag-and-drop move does — so open tabs and
        // .workspace.json must be repointed at the new path, not just told
        // a rename happened.
        if (renamed.path !== entry.path) {
          replaceOpenPath(entry.path, renamed.path)
          for (const suffix of ['ink', 'pdf', 'diagrams', 'assets']) {
            useWorkspaceStore.getState().addGitPendingPath(sidecarDir(entry.path, suffix))
            useWorkspaceStore.getState().addGitPendingPath(sidecarDir(renamed.path, suffix))
          }
        }
        useWorkspaceStore.getState().addGitPendingPath(entry.path)
        useWorkspaceStore.getState().addGitPendingPath(renamed.path)
        await refreshTree()
      } catch (err) {
        setFolderError(err instanceof Error ? err.message : String(err))
      }
    }

    async function handleDelete(e: React.MouseEvent) {
      e.stopPropagation()
      if (!(await confirm(`Delete "${entry.name}"?`))) return
      try {
        await api.notes.delete(workspace, entry.path)
      } catch (err) {
        setFolderError(err instanceof Error ? err.message : String(err))
        return
      }
      setFolderError(null)
      removeNote(entry.path)
      closeTab(entry.path)
      // Otherwise the deletion never enters the auto-commit's pathspec-scoped
      // pending list — the files are gone on disk, but `git rm` never runs,
      // so they silently never reach the repo (or GitHub) at all. delete_note
      // removes every sidecar, so every sidecar needs to be queued too.
      for (const suffix of ['ink', 'pdf', 'diagrams', 'assets']) {
        useWorkspaceStore.getState().addGitPendingPath(sidecarDir(entry.path, suffix))
      }
      useWorkspaceStore.getState().addGitPendingPath(entry.path)
    }

    return (
      <li
        className={`tree-row tree-note${isActive ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
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
        const newPath = await api.notes.moveNote(notePath, entry.path)
        replaceOpenPath(notePath, newPath)
        // Old path/dirs so git registers the removal, new ones so it
        // registers the addition — a bare fs::rename shows up as both to git
        // status. move_note_at moves every sidecar (ink/pdf/diagrams/assets)
        // alongside the note itself, so all of them need to be queued too.
        for (const suffix of ['ink', 'pdf', 'diagrams', 'assets']) {
          useWorkspaceStore.getState().addGitPendingPath(sidecarDir(notePath, suffix))
          useWorkspaceStore.getState().addGitPendingPath(sidecarDir(newPath, suffix))
        }
        useWorkspaceStore.getState().addGitPendingPath(notePath)
        useWorkspaceStore.getState().addGitPendingPath(newPath)
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
    const count = notes.filter((n) => isUnderPath(n.path, entry.path)).length
    const noun = count === 1 ? 'note' : 'notes'
    if (!(await confirm(`Delete "${entry.name}" and its ${count} ${noun}? This cannot be undone.`))) return
    try {
      await api.notes.deleteFolder(entry.path)
      closeTabsUnder(entry.path)
      setSelectedFolder(null)
      setFolderError(null)
      // A directory pathspec stages every deletion under it in one shot —
      // no need to enumerate each note individually. Without this the whole
      // subtree's deletion never enters the auto-commit's pending list.
      useWorkspaceStore.getState().addGitPendingPath(entry.path)
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
            style={{ paddingLeft: 8 + depth * 14 }}
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
          <ContextMenuItem onSelect={() => void handleRenameFolder()}>
            <Pencil size={14} /> Rename
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => void handleDeleteFolder()}>
            <Trash2 size={14} /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isExpanded && (
        <ul className="folder-tree tree-guide" style={{ marginLeft: 8 + depth * 14 + 6 }}>
          {entry.children.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
