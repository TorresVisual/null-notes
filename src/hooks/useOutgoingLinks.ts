import { useEffect, useMemo, useState } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { analyseOutgoingLinks } from '../lib/outgoingLinks'
import type { OutgoingLinks } from '../lib/outgoingLinks'

// Same slow cadence as the reindex debounce: the scan reads the whole note
// against every title, so it trails typing rather than running per keystroke.
const SETTLE_MS = 500

export function useOutgoingLinks(content: string, notePath: string): OutgoingLinks {
  const workspace = useWorkspaceStore((s) => s.path)
  const notes = useNotesStore((s) => s.notes)
  const [settled, setSettled] = useState({ content, notePath })

  useEffect(() => {
    const timer = setTimeout(() => setSettled({ content, notePath }), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [content, notePath])

  return useMemo(
    () => analyseOutgoingLinks(settled.content, settled.notePath, workspace ?? '', notes),
    [settled, workspace, notes],
  )
}
