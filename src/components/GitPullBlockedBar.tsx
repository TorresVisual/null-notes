import { GitBranch } from 'lucide-react'

interface GitPullBlockedBarProps {
  output: string
  paths: string[]
  onDismiss: () => void
}

// P5-4: the ff-only pull itself refused, most likely an uncommitted local
// change conflicting with an incoming one. Nothing was overwritten, but the
// workspace is now silently behind the remote until this is resolved — same
// "you decide" shape as GitDivergedBar, whose `.conflict-bar` styling this
// reuses rather than inventing a third bar look. `paths` is parsed for free
// out of git's own refusal message (#82), so the note can be named instead
// of leaving the raw stderr behind a tooltip.
export function GitPullBlockedBar({ output, paths, onDismiss }: GitPullBlockedBarProps) {
  const names = paths.map((p) => p.split('/').pop() ?? p).join(', ')
  return (
    <div className="conflict-bar is-warning" role="alert">
      <GitBranch size={14} />
      <span title={output}>
        Couldn&apos;t sync with the remote — {names || 'a local uncommitted change'} conflicts with an
        incoming one. Nothing was overwritten; resolve it in the terminal or your Git tool.
      </span>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
