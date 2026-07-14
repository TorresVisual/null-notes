import { useState } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { ImportButton } from './ImportButton'
import { api } from '../lib/tauri'

interface SidebarProps {
  onSearchOpen: () => void
}

export function Sidebar({ onSearchOpen }: SidebarProps) {
  const notes = useNotesStore((s) => s.notes)
  const removeNote = useNotesStore((s) => s.removeNote)
  const addNote = useNotesStore((s) => s.addNote)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const { openWorkspace } = useWorkspace()
  const [search, setSearch] = useState('')

  const visibleNotes = search.trim()
    ? notes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
    : notes

  async function handleCreate() {
    if (!workspacePath) return
    const title = prompt('Note title:')
    if (!title) return
    const meta = await api.notes.create(workspacePath, title)
    addNote(meta)
    openTab(meta.path)
  }

  async function handleDelete(notePath: string) {
    if (!confirm('Delete this note?')) return
    await api.notes.delete(notePath)
    removeNote(notePath)
    closeTab(notePath)
  }

  const workspaceName = workspacePath
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
    : null

  return (
    <aside className="sidebar">
      {workspaceName && <p className="workspace-name" title={workspacePath ?? ''}>{workspaceName}</p>}
      <button onClick={() => void openWorkspace()}>Open Workspace</button>
      <button onClick={() => void handleCreate()} disabled={!workspacePath}>
        New Note
      </button>
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
      <ul>
        {visibleNotes.map((note) => (
          <li key={note.path}>
            <button className="note-link" onClick={() => openTab(note.path)}>
              {note.title}
            </button>
            <button
              className="note-delete"
              onClick={() => void handleDelete(note.path)}
              aria-label={`Delete ${note.title}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
