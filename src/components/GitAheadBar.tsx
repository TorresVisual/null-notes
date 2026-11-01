import { GitBranch } from 'lucide-react'

interface GitAheadBarProps {
  ahead: number
  onDismiss: () => void
}

// #81: N local commits never made it to the remote (a prior push failed
// offline/auth) and nothing retried it until now. useGitAutoPull already
// retries on every checkForUpdates cycle before this renders, so seeing this
// bar at all means the retry itself is still failing — reuses ConflictBar's
// `.conflict-bar` styling rather than inventing a fourth bar look.
export function GitAheadBar({ ahead, onDismiss }: GitAheadBarProps) {
  return (
    <div className="conflict-bar is-warning" role="alert">
      <GitBranch size={14} />
      <span>
        {ahead} local commit{ahead === 1 ? '' : 's'} still haven&apos;t reached the remote — the
        last push failed and Null Notes will keep retrying. Push manually from your Git tool if
        it&apos;s urgent.
      </span>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
