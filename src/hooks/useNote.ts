import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'

export type SaveState = 'clean' | 'dirty' | 'saving' | 'error'

export const SAVE_DEBOUNCE_MS = 600
// Indexing is deliberately lazier than the file write: search may lag behind,
// the file on disk may not.
export const REINDEX_DEBOUNCE_MS = 2500

interface PendingWrite {
  path: string
  workspace: string
  content: string
}

export function useNote(path: string | null) {
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('clean')
  const [saveError, setSaveError] = useState<string | null>(null)
  const workspacePath = useWorkspaceStore((s) => s.path)

  const pendingWrite = useRef<PendingWrite | null>(null)
  const pendingIndex = useRef<PendingWrite | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const indexTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!path) {
      setContent('')
      return
    }
    setIsLoading(true)
    setSaveState('clean')
    setSaveError(null)
    api.notes
      .open(path)
      .then(setContent)
      .catch((e: unknown) => setSaveError(`Could not open note: ${String(e)}`))
      .finally(() => setIsLoading(false))
  }, [path])

  const flushIndex = useCallback(async () => {
    if (indexTimer.current) {
      clearTimeout(indexTimer.current)
      indexTimer.current = null
    }
    const job = pendingIndex.current
    if (!job) return
    pendingIndex.current = null
    try {
      await api.notes.reindex(job.path, job.workspace, job.content)
    } catch (e) {
      // The note itself is safe on disk; a stale index is recoverable, so
      // requeue quietly rather than alarming the user about their data.
      if (!pendingIndex.current) pendingIndex.current = job
      console.error('reindex failed', e)
    }
  }, [])

  const scheduleIndex = useCallback(
    (job: PendingWrite) => {
      pendingIndex.current = job
      if (indexTimer.current) clearTimeout(indexTimer.current)
      indexTimer.current = setTimeout(() => void flushIndex(), REINDEX_DEBOUNCE_MS)
    },
    [flushIndex],
  )

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const job = pendingWrite.current
    if (!job) return
    pendingWrite.current = null
    setSaveState('saving')
    try {
      await api.notes.save(job.path, job.content)
      if (!pendingWrite.current) {
        setSaveState('clean')
        setSaveError(null)
      }
      scheduleIndex(job)
    } catch (e) {
      // Keep the buffer dirty — a failed write must never look like a saved one.
      if (!pendingWrite.current) pendingWrite.current = job
      setSaveState('error')
      setSaveError(String(e))
    }
  }, [scheduleIndex])

  const flush = useCallback(async () => {
    await flushSave()
    await flushIndex()
  }, [flushSave, flushIndex])

  const save = useCallback(
    (markdown: string) => {
      setContent(markdown)
      if (!path || !workspacePath) return
      pendingWrite.current = { path, workspace: workspacePath, content: markdown }
      setSaveState('dirty')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS)
    },
    [path, workspacePath, flushSave],
  )

  // Dismissing only hides the message — the buffer stays dirty and will retry
  // on the next edit or flush, so an unsaved note never reads as saved.
  const dismissError = useCallback(() => {
    setSaveError(null)
    setSaveState(pendingWrite.current ? 'dirty' : 'clean')
  }, [])

  useEffect(() => () => void flush(), [path, flush])

  useEffect(() => {
    const handler = () => void flush()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [flush])

  return {
    content,
    save,
    isLoading,
    saveState,
    saveError,
    flush,
    retrySave: flushSave,
    dismissError,
  }
}
