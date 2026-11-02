import { FilePlus } from 'lucide-react'
import { useCreateNote } from '../hooks/useCreateNote'
import { SAMPLE_NOTE_CONTENT, SAMPLE_NOTE_TITLE } from '../lib/sampleNote'

export function EmptyWorkspace() {
  const createNote = useCreateNote()

  return (
    <div className="empty-workspace">
      <h2 className="empty-workspace-title">This workspace has no notes yet</h2>
      <p className="empty-workspace-body">
        Start with a sample that shows math, code, callouts, tasks and flashcards, or begin with a
        blank note.
      </p>
      <div className="empty-workspace-actions">
        <button
          className="home-action-primary empty-workspace-primary"
          onClick={() => void createNote(SAMPLE_NOTE_TITLE, SAMPLE_NOTE_CONTENT)}
        >
          <FilePlus size={14} /> Create a sample note
        </button>
        <span className="empty-workspace-hint">
          or press <kbd>Ctrl N</kbd> for a blank note, <kbd>?</kbd> for shortcuts
        </span>
      </div>
    </div>
  )
}
