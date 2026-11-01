import { useEffect } from 'react'
import { api } from '../lib/tauri'
import { useDirtyPathsStore } from '../store/dirtyPaths'
import { useWorkspaceStore } from '../store/workspace'

// Tells the backend which notes have edits that are not on disk yet, so a
// `nullnotes` write to one of them is refused instead of racing the autosave.
// The command only exists on Windows builds; elsewhere the call just fails.
export function useReportDirtyPaths(): void {
  useEffect(() => {
    let reportedFor: string | null = null
    const report = (workspace: string, paths: string[]) =>
      void api.cli.reportDirtyPaths(workspace, paths).catch(() => {})
    return useDirtyPathsStore.subscribe((state) => {
      const workspace = useWorkspaceStore.getState().path
      if (reportedFor && reportedFor !== workspace) report(reportedFor, [])
      reportedFor = workspace
      if (workspace) report(workspace, [...state.paths])
    })
  }, [])
}
