import { useEffect, useState } from 'react'
import { FilePlus, FolderPlus, PenLine, Search } from 'lucide-react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace, refreshTree } from '../hooks/useWorkspace'
import { useCreateNote } from '../hooks/useCreateNote'
import { ImportButton } from './ImportButton'
import { FolderTree } from './FolderTree'
import { FolderContextMenu } from './FolderContextMenu'
import { TagList } from './TagList'
import { buildFolderTree } from '../lib/folderTree'
import { api } from '../lib/tauri'
import { inkApi } from '../lib/ink'
import { canvasNoteBody } from '../lib/canvasNote'
import type { NoteMetadata } from '../types'
import type { InkData } from '../ink/types'

// Fits the note column at 1x and grows downward as you write; zooming past
// the column width scrolls horizontally rather than clipping.
const EMPTY_PAGE: InkData = { width: 700, height: 1200, strokes: [], shapes: [] }

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
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const folderError = useWorkspaceStore((s) => s.folderError)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const { openWorkspace } = useWorkspace()
  const createNote = useCreateNote()
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

  // Created as a real note first, then rewritten as a canvas body, so it picks
  // up the same naming, indexing and folder rules as any other note.
  async function handleCreateCanvasNote() {
    if (!workspacePath) return
    const title = prompt('Canvas note title:')
    if (!title) return
    const folder = selectedFolder ?? workspacePath
    try {
      const meta = await api.notes.create(workspacePath, folder, title)
      const dir = await inkApi.ensureDir(meta.path)
      const sep = dir.includes('\\') ? '\\' : '/'
      const svgPath = `${dir}${sep}page.svg`
      await inkApi.write(svgPath, EMPTY_PAGE)
      const body = canvasNoteBody(title, svgPath, EMPTY_PAGE.width, EMPTY_PAGE.height)
      await api.notes.save(meta.path, body)
      await api.notes.reindex(meta.path, workspacePath, body)
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
      ) : (
        <FolderTree entries={tree} />
      )}
      <FolderContextMenu />
    </aside>
  )
}
