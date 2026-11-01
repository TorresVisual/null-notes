import { useEffect } from 'react'
import { useBaseRowsStore } from '../store/baseRows'
import { useWorkspaceStore } from '../store/workspace'
import type { BaseRow } from '../types'

// Later refreshes ride useExternalChanges, which already hears every
// workspace-changed event.
export function useBaseRows(): BaseRow[] {
  const workspace = useWorkspaceStore((s) => s.path)
  const rows = useBaseRowsStore((s) => s.rows)

  useEffect(() => {
    if (workspace) void useBaseRowsStore.getState().load(workspace)
  }, [workspace])

  return rows
}
