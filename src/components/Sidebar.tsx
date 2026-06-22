import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { api } from '../lib/tauri'

export function Sidebar() {
  const notes = useNotesStore((s) => s.notes)
  const removeNote = useNotesStore((s) => s.removeNote)
  const addNote = useNotesStore((s) => s.addNote)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const { openWorkspace } = useWorkspace()

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

  return (
    <aside className="sidebar">
      <button onClick={() => void openWorkspace()}>Open Workspace</button>
      <button onClick={() => void handleCreate()} disabled={!workspacePath}>
        New Note
      </button>
      <ul>
        {notes.map((note) => (
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
