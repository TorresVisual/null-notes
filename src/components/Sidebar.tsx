import { useEffect, useState } from 'react'
import { FilePlus, FolderPlus, PenLine, Search, Settings } from 'lucide-react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { useCreateNote } from '../hooks/useCreateNote'
import { useCreateFolder } from '../hooks/useCreateFolder'
import { useCreateCanvasNote } from '../hooks/useCreateCanvasNote'
import { ImportButton } from './ImportButton'
import { FolderTree } from './FolderTree'
import { FolderContextMenu } from './FolderContextMenu'
import { TagList } from './TagList'
import { buildFolderTree } from '../lib/folderTree'
import { folderName } from '../lib/pathPrefix'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

interface SidebarProps {
  onSearchOpen: () => void
  onSettingsOpen: () => void
}

export function Sidebar({ onSearchOpen, onSettingsOpen }: SidebarProps) {
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const folderError = useWorkspaceStore((s) => s.folderError)
  const { openWorkspace } = useWorkspace()
  const createNote = useCreateNote()
  const createFolder = useCreateFolder()
  const createCanvasNote = useCreateCanvasNote()
  const [tagFilteredNotes, setTagFilteredNotes] = useState<NoteMetadata[]>([])

  useEffect(() => {
    if (!tagFilter || !workspacePath) {
      setTagFilteredNotes([])
      return
    }
    api.notes.notesWithTag(workspacePath, tagFilter).then(setTagFilteredNotes)
  }, [tagFilter, workspacePath])

  const tree = workspacePath ? buildFolderTree(workspacePath, folders, notes) : []

  async function handleCreateNote() {
    const title = prompt('Note title:')
    if (!title) return
    await createNote(title)
  }

  async function handleCreateCanvasNote() {
    const title = prompt('Canvas note title:')
    if (!title) return
    await createCanvasNote(title)
  }

  async function handleCreateFolder() {
    const name = prompt('Folder name:')
    if (!name) return
    await createFolder(name)
  }

  const workspaceName = workspacePath ? folderName(workspacePath) : null

  return (
    <aside className="sidebar">
      {workspaceName && <p className="workspace-name" title={workspacePath ?? ''}>{workspaceName}</p>}
      <button onClick={() => void openWorkspace()}>Open Workspace</button>
      <div className="sidebar-new-actions">
        <button onClick={() => void handleCreateNote()} disabled={!workspacePath}>
          <FilePlus size={14} /> New Note
        </button>
        <button onClick={() => void handleCreateFolder()} disabled={!workspacePath}>
          <FolderPlus size={14} /> New Folder
        </button>
        <button onClick={() => void handleCreateCanvasNote()} disabled={!workspacePath}>
          <PenLine size={14} /> New Canvas
        </button>
      </div>
      <ImportButton />
      <button className="search-open-btn" onClick={onSearchOpen}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={13} /> Search
        </span>
        <kbd>Ctrl K</kbd>
      </button>
      <button className="search-open-btn" onClick={onSettingsOpen}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Settings size={13} /> Settings
        </span>
      </button>
      {folderError && <p className="sidebar-error">{folderError}</p>}
      <TagList />
      {tagFilter ? (
        <ul className="folder-tree">
          {tagFilteredNotes.map((note) => (
            <li
              key={note.path}
              className="tree-row tree-note"
              onClick={() => openTab(note.path)}
            >
              <span className="tree-label">{note.title}</span>
            </li>
          ))}
        </ul>
      ) : workspacePath && tree.length === 0 ? (
        <p className="sidebar-onboarding">
          No notes yet — click <strong>New Note</strong> above, or Ctrl N, to create your first one.
        </p>
      ) : (
        <FolderTree entries={tree} />
      )}
      <FolderContextMenu />
    </aside>
  )
}
