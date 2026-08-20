import { Check, CircleDot, GitCommitHorizontal } from 'lucide-react'
import type { GitCommitStatus as Status } from '../types'

interface GitCommitStatusProps {
  status: Status
  detail: string | null
}

const LABEL: Record<Status, string> = {
  idle: '',
  committing: 'Committing…',
  committed: 'Committed',
  skipped: 'Commit skipped',
  error: 'Commit failed',
  pushFailed: 'Push failed',
}

// The "what's still safe" half of each error/skip tooltip — the badge label
// stays a short, fixed phrase; this is where the reassurance and the actual
// reason (threaded from useGitAutoCommit's CommitOutcome/catch) both live.
const SAFE_MESSAGE: Partial<Record<Status, string>> = {
  error: 'Your saved changes are safe on disk — only the Git commit failed. It will retry automatically on your next edit.',
  skipped: 'Your saved changes are safe on disk — the commit didn\'t run yet. It will retry automatically on your next edit.',
  pushFailed: 'Your commit is safe in the local repository — only the push to the remote failed. Push manually from your Git tool, or it will go out with the next commit.',
}

function tooltipFor(status: Status, detail: string | null): string | undefined {
  const safe = SAFE_MESSAGE[status]
  if (!safe) return undefined
  return detail ? `${safe} (${detail})` : safe
}

function StateIcon({ status }: { status: Status }) {
  if (status === 'committing') return <CircleDot size={12} />
  if (status === 'committed') return <Check size={12} />
  return <GitCommitHorizontal size={12} />
}

// Idle renders nothing — this badge only appears once there's something to
// say, unlike SaveStatus which always shows the current state.
export function GitCommitStatus({ status, detail }: GitCommitStatusProps) {
  if (status === 'idle') return null
  const tooltip = tooltipFor(status, detail)
  return (
    <div className={`git-commit-status ${status}`} role="status" aria-live="polite">
      <StateIcon status={status} />
      <span title={tooltip}>{LABEL[status]}</span>
    </div>
  )
}
