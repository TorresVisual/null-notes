import { Check, CircleDot, GitCommitHorizontal } from 'lucide-react'
import type { GitCommitStatus as Status } from '../types'

interface GitCommitStatusProps {
  status: Status
}

const LABEL: Record<Status, string> = {
  idle: '',
  committing: 'Committing…',
  committed: 'Committed',
  skipped: 'Commit skipped',
  error: 'Commit failed',
}

// Idle renders nothing — this badge only appears once there's something to
// say, unlike SaveStatus which always shows the current state.
export function GitCommitStatus({ status }: GitCommitStatusProps) {
  if (status === 'idle') return null
  return (
    <div className={`git-commit-status ${status}`} role="status" aria-live="polite">
      {status === 'committing' && <CircleDot size={12} />}
      {status === 'committed' && <Check size={12} />}
      {(status === 'skipped' || status === 'error') && <GitCommitHorizontal size={12} />}
      <span>{LABEL[status]}</span>
    </div>
  )
}
