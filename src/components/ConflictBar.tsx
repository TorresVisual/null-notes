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
      <button className="is-primary" onClick={onKeepMine}>Keep mine</button>
      <button onClick={onReloadTheirs}>Reload theirs</button>
    </div>
  )
}
