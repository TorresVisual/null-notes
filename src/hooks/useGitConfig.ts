import { useCallback } from 'react'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { GitWorkspaceConfig } from '../types'

/**
 * Reads and writes the per-workspace, machine-local Git config (P5-1) —
 * shared by the one-time "enable auto-commit?" prompt and the Settings
 * panel's revisit toggle, so there is exactly one place that persists it.
 *
 * Persisted inside `.workspace.json`, alongside the rest of the session —
 * it's already the one workspace-folder file P3-4 gitignores, the
 * per-workspace-but-machine-local home this config needs.
 */
export function useGitConfig() {
  const setGit = useWorkspaceStore((s) => s.setGit)

  const updateGit = useCallback(
    async (patch: Partial<GitWorkspaceConfig>) => {
      const {
        path,
        git,
        openTabs,
        activeTab,
        sidebarCollapsed,
        tagsCollapsed,
        pinnedTabs,
        canvasViewports,
        expandedFolders,
        recentSearches,
      } = useWorkspaceStore.getState()
      if (!path) return
      const next = { ...git, ...patch }
      setGit(next)
      await api.workspace.save(path, {
        openTabs,
        activeTab,
        sidebarCollapsed,
        tagsCollapsed,
        pinnedTabs,
        canvasViewports,
        expandedFolders,
        recentSearches,
        git: next,
      })
    },
    [setGit],
  )

  return { updateGit }
}
