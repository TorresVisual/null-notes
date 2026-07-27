import { AlertTriangle } from 'lucide-react'

interface ConflictBarProps {
  onKeepMine: () => void
  onReloadTheirs: () => void
}

export function ConflictBar({ onKeepMine, onReloadTheirs }: ConflictBarProps) {
  return (
    <div className="conflict-bar" role="alert">
      <AlertTriangle size={14} />
      <span>This note changed on disk while you were editing it.</span>
      <button onClick={onKeepMine}>Keep mine</button>
      <button onClick={onReloadTheirs}>Reload theirs</button>
    </div>
  )
}
