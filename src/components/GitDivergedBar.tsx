import { useState } from 'react'
import { GitBranch } from 'lucide-react'

interface GitDivergedBarProps {
  ahead: number
  behind: number
  localPaths: string[]
  remotePaths: string[]
  onSync: () => Promise<void>
  onDismiss: () => void
}

function noteNames(paths: string[]): string {
  return paths.map((p) => p.split('/').pop() ?? p).join(', ')
}

// P5-4: local and remote history have genuinely diverged, so nothing here
// auto-merges, auto-rebases, or resets on its own. When the two sides touch
// disjoint notes (#82) a rebase genuinely can't conflict, so "Sync now" is
// offered as a deliberate, user-clicked exception to that rule — the
// background auto-pull cycle itself still never does this unprompted.
// Reuses ConflictBar's `.conflict-bar` styling rather than inventing a
// second bar look for the same "you decide" shape of message.
export function GitDivergedBar({
  ahead,
  behind,
  localPaths,
  remotePaths,
  onSync,
  onDismiss,
}: GitDivergedBarProps) {
  const [syncing, setSyncing] = useState(false)
  const disjoint =
    localPaths.length > 0 && remotePaths.length > 0 && !localPaths.some((p) => remotePaths.includes(p))

  return (
    <div className="conflict-bar" role="alert">
      <GitBranch size={14} />
      <span>
        Local and remote history have diverged — you&apos;re ahead by {ahead} ({noteNames(localPaths)}),
        behind by {behind} ({noteNames(remotePaths)}).{' '}
        {disjoint
          ? "The two sides touch different notes, so this can sync without a conflict."
          : 'Resolve it in the terminal or your Git tool; Null Notes never merges or rebases automatically.'}
      </span>
      {disjoint && (
        <button
          disabled={syncing}
          onClick={() => {
            setSyncing(true)
            void onSync().finally(() => setSyncing(false))
          }}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      )}
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
