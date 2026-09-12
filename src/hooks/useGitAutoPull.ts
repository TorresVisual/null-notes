import { useCallback } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { canAutoPush } from '../lib/git'

/**
 * Fetch-and-compare on workspace open (P5-4). A fast-forward is silent — the
 * resulting file changes are an ordinary external edit that P0-5's watcher
 * and useNote's existing conflict handling already cover, so this adds no
 * reload logic of its own. A diverged history only ever sets state for
 * `GitDivergedBar` to render; it never merges, rebases, or resets.
 */
export function useGitAutoPull() {
  const checkForUpdates = useCallback(async (workspace: string) => {
    const { setGitDiverged, setGitPullBlocked, setGitAhead } = useWorkspaceStore.getState()
    try {
      const outcome = await api.git.fetchAndCompare(workspace)
      setGitDiverged(
        outcome.kind === 'diverged'
          ? {
              ahead: outcome.ahead,
              behind: outcome.behind,
              localPaths: outcome.localPaths,
              remotePaths: outcome.remotePaths,
            }
          : null,
      )
      // `blocked` means the ff-only merge itself refused — most likely an
      // uncommitted local change conflicting with an incoming one. The
      // working tree is untouched, but staying silent here (the old
      // behavior) left the workspace quietly behind the remote with no way
      // to notice short of opening a terminal. Every other outcome clears
      // it, including a thrown error below — a later successful check
      // supersedes a stale blocked notice.
      setGitPullBlocked(
        outcome.kind === 'blocked' ? { output: outcome.output, paths: outcome.paths } : null,
      )
      // #81: purely ahead (a prior push never landed) is this cycle's retry
      // point — checkForUpdates already runs on open, a 5-min interval, and
      // window focus, so a push that failed offline lands on whichever of
      // those comes first instead of sitting silent until the user notices.
      if (outcome.kind === 'ahead') {
        const { repoMode, git } = useWorkspaceStore.getState()
        if (!canAutoPush(repoMode, git)) {
          setGitAhead(outcome.ahead)
        } else {
          try {
            const pushOutcome = await api.git.pushNotes(workspace, repoMode!, git.allowCodeRepoPush)
            setGitAhead(pushOutcome.kind === 'pushed' ? null : outcome.ahead)
          } catch (e) {
            setGitAhead(outcome.ahead)
            console.error('git retry-push failed', e)
          }
        }
      } else {
        setGitAhead(null)
      }
    } catch (e) {
      // Best-effort, same posture as P5-1's repo detection: never blocks
      // opening the workspace. Genuine fetch failures (most commonly no
      // network) stay silent rather than surfacing an error on every offline
      // open — only the ff-only refusal above is worth interrupting for.
      setGitDiverged(null)
      setGitPullBlocked(null)
      console.error('git fetch/compare failed', e)
    }
  }, [])

  return { checkForUpdates }
}
