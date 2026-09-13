import type { GitWorkspaceConfig, RepoMode } from '../types'
import { useWorkspaceStore } from '../store/workspace'
import { api } from './tauri'

// Never push a CodeRepo workspace without explicit per-workspace consent
// (SettingsPanel's confirm dialog) — notesOnly/notesMonorepo are pure note
// storage and push freely. Shared by canAutoPush (adds the autoPush toggle)
// and #85's manual "Sync now", which pushes on this mode gating alone.
export function canPushHere(repoMode: RepoMode | null, git: GitWorkspaceConfig): boolean {
  return (
    repoMode === 'notesOnly' ||
    repoMode === 'notesMonorepo' ||
    (repoMode === 'codeRepo' && git.allowCodeRepoPush)
  )
}

// Shared by useGitAutoCommit's post-commit push and useGitAutoPull's #81
// retry so the two can't drift.
export function canAutoPush(repoMode: RepoMode | null, git: GitWorkspaceConfig): boolean {
  return git.autoPush && canPushHere(repoMode, git)
}

// #86: every git-mutating call (auto-commit, push, fetch/pull) funnels
// through here so two never run concurrently against one workspace — a
// concurrent `git commit`/`git push`/`git merge` pair races on
// `.git/index.lock`, and closing the window mid-sync can otherwise kill an
// in-flight git subprocess before it finishes. Each caller wraps its own
// whole operation (never a piece already run from inside another wrapped
// call), so queuing here is always sequential, never nested.
let gitQueue: Promise<unknown> = Promise.resolve()

export function withGitLock<T>(run: () => Promise<T>): Promise<T> {
  const result = gitQueue.then(run, run)
  gitQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

// The push step itself, shared by useGitAutoCommit's post-commit push and
// #85's manual "Sync now" — only their gating (canAutoPush vs. canPushHere)
// differs. Most outcomes here are a resolved Ok value, not a thrown error —
// only authFailed/rejected are real failures worth surfacing.
export async function pushIfAllowed(
  path: string,
  repoMode: RepoMode,
  git: GitWorkspaceConfig,
): Promise<void> {
  const { setGitCommitStatus, setGitCommitDetail } = useWorkspaceStore.getState()
  try {
    const pushOutcome = await api.git.pushNotes(path, repoMode, git.allowCodeRepoPush)
    if (pushOutcome.kind === 'authFailed' || pushOutcome.kind === 'rejected') {
      setGitCommitStatus('pushFailed')
      setGitCommitDetail(pushOutcome.output)
    }
  } catch (e) {
    setGitCommitStatus('pushFailed')
    setGitCommitDetail(String(e))
  }
}
