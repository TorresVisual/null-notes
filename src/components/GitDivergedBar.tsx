import { GitBranch } from 'lucide-react'

interface GitDivergedBarProps {
  ahead: number
  behind: number
  onDismiss: () => void
}

// P5-4: local and remote history have genuinely diverged, so nothing here
// auto-merges, auto-rebases, or resets. Reuses ConflictBar's `.conflict-bar`
// styling rather than inventing a second bar look for the same "you decide"
// shape of message.
export function GitDivergedBar({ ahead, behind, onDismiss }: GitDivergedBarProps) {
  return (
    <div className="conflict-bar" role="alert">
      <GitBranch size={14} />
      <span>
        Local and remote history have diverged — you&apos;re ahead by {ahead}, behind by {behind}.
        Resolve it in the terminal or your Git tool; null-notes never merges or rebases automatically.
      </span>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
