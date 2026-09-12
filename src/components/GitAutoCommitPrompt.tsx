import { GitBranch } from 'lucide-react'
import type { RepoMode } from '../types'

interface GitAutoCommitPromptProps {
  mode: RepoMode
  // #78: a remote plus existing `notes:` commits found on this workspace —
  // strong evidence another machine already has auto-commit enabled here.
  priorAutomation: boolean
  onEnable: () => void
  onDecline: () => void
}

// One-time, per-workspace (P5-1). "Enable" only ever sets the machine-local
// `autoCommit` flag P5-2 will act on — nothing here runs a Git command.
export function GitAutoCommitPrompt({ mode, priorAutomation, onEnable, onDecline }: GitAutoCommitPromptProps) {
  const context =
    mode === 'notesOnly'
      ? 'This workspace is a Git repository.'
      : mode === 'notesMonorepo'
        ? 'This workspace shares a Git repository with other note workspaces only — auto-commit stays scoped to its own paths, and auto-push works here too.'
        : 'This workspace sits inside a larger code repository — auto-commit only ever touches note paths here, and never auto-pushes.'

  const question = priorAutomation
    ? 'This workspace is already being auto-committed from another machine. Enable it here too to keep them in sync?'
    : 'Auto-commit your notes here?'

  return (
    <div className="git-prompt" role="alert">
      <GitBranch size={14} />
      <span>{context} {question}</span>
      <button onClick={onEnable}>Enable</button>
      <button onClick={onDecline}>Not now</button>
    </div>
  )
}
