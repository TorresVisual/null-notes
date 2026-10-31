import { AlertTriangle } from 'lucide-react'

interface ConflictBarProps {
  message?: string
  onKeepMine: () => void
  onReloadTheirs: () => void
}

export function ConflictBar({ message = 'This note changed on disk while you were editing it.', onKeepMine, onReloadTheirs }: ConflictBarProps) {
  return (
    <div className="conflict-bar" role="alert">
      <AlertTriangle size={14} />
      <span>{message}</span>
      <button onClick={onKeepMine}>Keep mine</button>
      <button onClick={onReloadTheirs}>Reload theirs</button>
    </div>
  )
}
