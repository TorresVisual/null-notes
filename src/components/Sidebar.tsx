import { useEffect, useState } from 'react'
import { FilePlus, FolderOpen, FolderPlus, Home, LayoutTemplate, PenLine, Search, Settings } from 'lucide-react'
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
import { promptText } from '../store/promptDialog'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

interface SidebarProps {
  onSearchOpen: () => void
  onSettingsOpen: () => void
  onTemplateOpen: () => void
}

export function Sidebar({ onSearchOpen, onSettingsOpen, onTemplateOpen }: SidebarProps) {
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
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
    const title = await promptText('Note title:')
    if (!title) return
    await createNote(title)
  }

  async function handleCreateCanvasNote() {
    const title = await promptText('Canvas note title:')
    if (!title) return
    await createCanvasNote(title)
  }

  async function handleCreateFolder() {
    const name = await promptText('Folder name:')
    if (!name) return
    await createFolder(name)
  }

  const workspaceName = workspacePath ? folderName(workspacePath) : null

  return (
    <aside className="sidebar">
      {workspaceName && <p className="workspace-name" title={workspacePath ?? ''}>{workspaceName}</p>}
      <button className="sidebar-workspace-btn" onClick={() => void openWorkspace()}>
        <FolderOpen size={14} /> Open Workspace
      </button>
      <p className="section-label">New</p>
      <div className="sidebar-new-actions">
        <button onClick={() => void handleCreateNote()} disabled={!workspacePath}>
          <FilePlus size={14} /> Note
        </button>
        <button onClick={() => void handleCreateFolder()} disabled={!workspacePath}>
          <FolderPlus size={14} /> Folder
        </button>
        <button onClick={() => void handleCreateCanvasNote()} disabled={!workspacePath}>
          <PenLine size={14} /> Canvas
        </button>
        <button onClick={onTemplateOpen} disabled={!workspacePath}>
          <LayoutTemplate size={14} /> Template
        </button>
      </div>
      <ImportButton />
      <div className="sidebar-group">
        <button
          className="search-open-btn"
          onClick={() => setActiveTab(null)}
          disabled={!workspacePath}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Home size={13} /> Home
          </span>
          <kbd>Ctrl H</kbd>
        </button>
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
      </div>
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
