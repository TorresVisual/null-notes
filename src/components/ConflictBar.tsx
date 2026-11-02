import { AlertTriangle } from 'lucide-react'

interface ConflictBarProps {
  noteName?: string
  message?: string
  onKeepMine: () => void
  onReloadTheirs: () => void
}

export function ConflictBar({ noteName, message, onKeepMine, onReloadTheirs }: ConflictBarProps) {
  return (
    <div className="conflict-bar" role="alert">
      <AlertTriangle size={14} />
      <span>{message ?? `${noteName ? `“${noteName}”` : 'This note'} changed on disk while you were editing it.`}</span>
      <button className="is-primary" onClick={onKeepMine} title="Save your version over the file on disk">
        Keep my version
      </button>
      <button onClick={onReloadTheirs} title="Discard your unsaved edits and load the file from disk">
        Load disk version
      </button>
    </div>
  )
}
