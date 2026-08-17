import { useCallback } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

/**
 * Fetch-and-compare on workspace open (P5-4). A fast-forward is silent — the
 * resulting file changes are an ordinary external edit that P0-5's watcher
 * and useNote's existing conflict handling already cover, so this adds no
 * reload logic of its own. A diverged history only ever sets state for
 * `GitDivergedBar` to render; it never merges, rebases, or resets.
 */
export function useGitAutoPull() {
  const checkForUpdates = useCallback(async (workspace: string) => {
    const { setGitDiverged } = useWorkspaceStore.getState()
    try {
      const outcome = await api.git.fetchAndCompare(workspace)
      setGitDiverged(outcome.kind === 'diverged' ? { ahead: outcome.ahead, behind: outcome.behind } : null)
    } catch (e) {
      // Best-effort, same posture as P5-1's repo detection: never blocks
      // opening the workspace.
      setGitDiverged(null)
      console.error('git fetch/compare failed', e)
    }
  }, [])

  return { checkForUpdates }
}
