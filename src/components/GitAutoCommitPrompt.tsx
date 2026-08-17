import { GitBranch } from 'lucide-react'
import type { RepoMode } from '../types'

interface GitAutoCommitPromptProps {
  mode: RepoMode
  onEnable: () => void
  onDecline: () => void
}

// One-time, per-workspace (P5-1). "Enable" only ever sets the machine-local
// `autoCommit` flag P5-2 will act on — nothing here runs a Git command.
export function GitAutoCommitPrompt({ mode, onEnable, onDecline }: GitAutoCommitPromptProps) {
  const context =
    mode === 'notesOnly'
      ? 'This workspace is a Git repository.'
      : 'This workspace sits inside a larger code repository — auto-commit only ever touches note paths here, and never auto-pushes.'

  return (
    <div className="git-prompt" role="alert">
      <GitBranch size={14} />
      <span>{context} Auto-commit your notes here?</span>
      <button onClick={onEnable}>Enable</button>
      <button onClick={onDecline}>Not now</button>
    </div>
  )
}
