import { useCallback, useEffect, useRef } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'

/**
 * Batches note saves into one commit per idle window (P5-2) — never per
 * save. `flushGitCommit` is also called directly on session end (Layout's
 * close-requested handler), so a session shorter than the idle window still
 * gets committed once before the app closes.
 */
export function useGitAutoCommit() {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushGitCommit = useCallback(async () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current)
      idleTimer.current = null
    }
    const { path, git, gitPendingPaths, clearGitPendingPaths, setGitCommitStatus } =
      useWorkspaceStore.getState()
    if (!path || !git.autoCommit || gitPendingPaths.length === 0) return

    const paths = gitPendingPaths
    setGitCommitStatus('committing')
    try {
      const outcome = await api.git.autoCommit(path, paths, git.skipHooks)
      if (outcome.kind === 'committed') {
        clearGitPendingPaths()
        setGitCommitStatus('committed')
      } else if (outcome.kind === 'nothingToCommit') {
        clearGitPendingPaths()
        setGitCommitStatus('idle')
      } else {
        // Skipped or hookFailed: report quietly, leave the batch pending so
        // the next trigger retries rather than losing it.
        setGitCommitStatus('skipped')
      }
    } catch (e) {
      setGitCommitStatus('error')
      console.error('auto-commit failed', e)
    }
  }, [])

  const gitPendingPaths = useWorkspaceStore((s) => s.gitPendingPaths)
  const idleMinutes = useWorkspaceStore((s) => s.git.idleMinutes)
  const autoCommit = useWorkspaceStore((s) => s.git.autoCommit)

  useEffect(() => {
    if (!autoCommit || gitPendingPaths.length === 0) return
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => void flushGitCommit(), idleMinutes * 60_000)
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [gitPendingPaths, idleMinutes, autoCommit, flushGitCommit])

  return { flushGitCommit }
}
