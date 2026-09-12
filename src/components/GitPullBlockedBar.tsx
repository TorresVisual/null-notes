import { GitBranch } from 'lucide-react'

interface GitPullBlockedBarProps {
  output: string
  onDismiss: () => void
}

// P5-4: the ff-only pull itself refused, most likely an uncommitted local
// change conflicting with an incoming one. Nothing was overwritten, but the
// workspace is now silently behind the remote until this is resolved — same
// "you decide" shape as GitDivergedBar, whose `.conflict-bar` styling this
// reuses rather than inventing a third bar look.
export function GitPullBlockedBar({ output, onDismiss }: GitPullBlockedBarProps) {
  return (
    <div className="conflict-bar" role="alert">
      <GitBranch size={14} />
      <span title={output}>
        Couldn&apos;t sync with the remote — a local uncommitted change conflicts with an incoming
        one. Nothing was overwritten; resolve it in the terminal or your Git tool.
      </span>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
