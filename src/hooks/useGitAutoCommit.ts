import { useCallback, useEffect, useRef } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { canAutoPush } from '../lib/git'

/**
 * Batches note saves into one commit per idle window (P5-2) — never per
 * save. `flushGitCommit` is also called directly on session end (Layout's
 * close-requested handler), so a session shorter than the idle window still
 * gets committed once before the app closes.
 */
// How long "Committed" stays visible before fading back to idle — long
// enough to register as a deliberate confirmation, short enough that it
// still reads as transient rather than a permanent status label.
const COMMITTED_DISPLAY_MS = 4000

export function useGitAutoCommit() {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushGitCommit = useCallback(async () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current)
      idleTimer.current = null
    }
    if (revertTimer.current) {
      clearTimeout(revertTimer.current)
      revertTimer.current = null
    }
    const {
      path,
      repoMode,
      git,
      gitPendingPaths,
      clearGitPendingPaths,
      setGitCommitStatus,
      setGitCommitDetail,
    } = useWorkspaceStore.getState()
    if (!path || !repoMode || !git.autoCommit || gitPendingPaths.length === 0) return

    const paths = gitPendingPaths
    setGitCommitStatus('committing')
    setGitCommitDetail(null)
    try {
      const outcome = await api.git.autoCommit(path, repoMode, paths, git.skipHooks)
      if (outcome.kind === 'committed') {
        clearGitPendingPaths()
        setGitCommitStatus('committed')
        // "Committed" would otherwise sit in the tab bar indefinitely until
        // the next commit cycle — revert to idle so it reads as a
        // confirmation rather than a permanent label. Guarded by a status
        // check so a commit that starts again in the meantime (which already
        // moves status off 'committed') isn't clobbered by this firing late.
        revertTimer.current = setTimeout(() => {
          if (useWorkspaceStore.getState().gitCommitStatus === 'committed') {
            setGitCommitStatus('idle')
          }
        }, COMMITTED_DISPLAY_MS)
        // notesMonorepo gets the same treatment as notesOnly: is_notes_monorepo
        // already confirmed the whole repo is nothing but sibling note
        // workspaces. codeRepo only ever pushes once the user has opted this
        // specific workspace in via the Settings panel's confirm dialog —
        // canAutoPush is what makes that true on the frontend side too, on
        // top of the Rust-level guard in checked_push.
        if (canAutoPush(repoMode, git)) {
          try {
            const pushOutcome = await api.git.pushNotes(path, repoMode, git.allowCodeRepoPush)
            // Most outcomes here are a resolved Ok value, not a thrown
            // error — only authFailed/rejected are real failures worth
            // surfacing. noRemote is an expected, non-error state (no
            // GitHub remote configured yet) and pushed needs no signal.
            if (pushOutcome.kind === 'authFailed' || pushOutcome.kind === 'rejected') {
              setGitCommitStatus('pushFailed')
              setGitCommitDetail(pushOutcome.output)
            }
          } catch (e) {
            // The commit itself already succeeded and is safe in the local
            // repo — only the push failed, so this is its own status rather
            // than reusing 'error' (which would misleadingly say the commit
            // failed) or staying silent (the previous behavior — a failed
            // push had no visible effect at all beyond a console.error).
            setGitCommitStatus('pushFailed')
            setGitCommitDetail(String(e))
          }
        }
      } else if (outcome.kind === 'nothingToCommit') {
        clearGitPendingPaths()
        setGitCommitStatus('idle')
      } else if (outcome.kind === 'hookFailed') {
        // Leave the batch pending so the next trigger retries rather than
        // losing it — the pre-commit hook's own output is the detail.
        setGitCommitStatus('skipped')
        setGitCommitDetail(outcome.output)
      } else {
        // outcome.kind === 'skipped': also leaves the batch pending.
        setGitCommitStatus('skipped')
        setGitCommitDetail(outcome.reason)
      }
    } catch (e) {
      setGitCommitStatus('error')
      setGitCommitDetail(String(e))
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
