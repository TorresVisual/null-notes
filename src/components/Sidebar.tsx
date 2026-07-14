import { useState } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace, refreshTree } from '../hooks/useWorkspace'
import { ImportButton } from './ImportButton'
import { FolderTree } from './FolderTree'
import { FolderContextMenu } from './FolderContextMenu'
import { buildFolderTree } from '../lib/folderTree'
import { api } from '../lib/tauri'

interface SidebarProps {
  onSearchOpen: () => void
}

export function Sidebar({ onSearchOpen }: SidebarProps) {
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const addNote = useNotesStore((s) => s.addNote)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const { openWorkspace } = useWorkspace()
  const [search, setSearch] = useState('')

  const visibleNotes = search.trim()
    ? notes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
    : notes

  const tree = workspacePath ? buildFolderTree(workspacePath, folders, visibleNotes) : []
  const folderError = useWorkspaceStore((s) => s.folderError)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)

  async function handleCreateNote() {
    if (!workspacePath) return
    const title = prompt('Note title:')
    if (!title) return
    const folder = selectedFolder ?? workspacePath
    try {
      const meta = await api.notes.create(workspacePath, folder, title)
      addNote(meta)
      openTab(meta.path)
      setFolderError(null)
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleCreateFolder() {
    if (!workspacePath) return
    const name = prompt('Folder name:')
    if (!name) return
    const parent = selectedFolder ?? workspacePath
    try {
      const newPath = await api.notes.createFolder(parent, name)
      setSelectedFolder(newPath)
      setFolderError(null)
      await refreshTree()
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : String(e))
    }
  }

  const workspaceName = workspacePath
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
    : null

  return (
    <aside className="sidebar">
      {workspaceName && <p className="workspace-name" title={workspacePath ?? ''}>{workspaceName}</p>}
      <button onClick={() => void openWorkspace()}>Open Workspace</button>
      <div className="sidebar-new-actions">
        <button onClick={() => void handleCreateNote()} disabled={!workspacePath}>
          New Note
        </button>
        <button onClick={() => void handleCreateFolder()} disabled={!workspacePath}>
          New Folder
        </button>
      </div>
      <ImportButton />
      <button className="search-open-btn" onClick={onSearchOpen}>
        Search <kbd>Ctrl K</kbd>
      </button>
      <input
        className="search-input"
        type="search"
        placeholder="Filter by title…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Filter notes by title"
      />
      {folderError && <p className="sidebar-error">{folderError}</p>}
      <FolderTree entries={tree} />
      <FolderContextMenu />
    </aside>
  )
}
