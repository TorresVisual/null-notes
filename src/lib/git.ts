import type { GitWorkspaceConfig, RepoMode } from '../types'

// Never push a CodeRepo workspace without explicit per-workspace consent
// (SettingsPanel's confirm dialog) — notesOnly/notesMonorepo are pure note
// storage and push freely once autoPush is on. Shared by useGitAutoCommit's
// post-commit push and useGitAutoPull's #81 retry so the two can't drift.
export function canAutoPush(repoMode: RepoMode | null, git: GitWorkspaceConfig): boolean {
  if (!git.autoPush) return false
  return (
    repoMode === 'notesOnly' ||
    repoMode === 'notesMonorepo' ||
    (repoMode === 'codeRepo' && git.allowCodeRepoPush)
  )
}
