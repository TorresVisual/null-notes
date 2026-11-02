import { useState, useEffect, useCallback, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useSettingsStore } from '../store/settings'
import { useDirtyPathsStore } from '../store/dirtyPaths'
import { folderName, sidecarDir } from '../lib/pathPrefix'

export type SaveState = 'clean' | 'dirty' | 'saving' | 'error'

export const SAVE_DEBOUNCE_MS = 600
// Indexing is deliberately lazier than the file write: search may lag behind,
// the file on disk may not.
export const REINDEX_DEBOUNCE_MS = 2500
const RECENT_WRITES = 4

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
  const saveDebounceMs = useSettingsStore((s) => s.settings.autosaveDebounceMs)

  const [conflict, setConflict] = useState(false)

  const pendingWrite = useRef<PendingWrite | null>(null)
  const pendingIndex = useRef<PendingWrite | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const indexTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef('')
  const incoming = useRef<string | null>(null)
  const recentWrites = useRef<string[]>([])

  const setContentAndRef = useCallback((value: string) => {
    contentRef.current = value
    setContent(value)
  }, [])

  useEffect(() => {
    if (!path || !workspacePath) {
      setContentAndRef('')
      return
    }
    setIsLoading(true)
    setSaveState('clean')
    setSaveError(null)
    setConflict(false)
    recentWrites.current = []
    api.notes
      .open(workspacePath, path)
      .then(setContentAndRef)
      .catch((e: unknown) => setSaveError(`Couldn't open note: ${String(e)}`))
      .finally(() => setIsLoading(false))
  }, [path, workspacePath, setContentAndRef])

  // The backend refuses CLI writes to a note whose edits are not on disk yet,
  // so "on disk" is the only clean state: saving and error count as dirty.
  useEffect(() => {
    if (!path) return
    const { markDirty, markClean } = useDirtyPathsStore.getState()
    if (saveState === 'clean') markClean(path)
    else markDirty(path)
  }, [path, saveState])

  useEffect(
    () => () => {
      if (path) useDirtyPathsStore.getState().markClean(path)
    },
    [path],
  )

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
    recentWrites.current = [...recentWrites.current.slice(1 - RECENT_WRITES), job.content]
    try {
      await api.notes.save(job.workspace, job.path, job.content)
      useWorkspaceStore.getState().addGitPendingPath(job.path)
      if (!pendingWrite.current) {
        setSaveState('clean')
        setSaveError(null)
      }
      scheduleIndex(job)
    } catch (e) {
      // Keep the buffer dirty — a failed write must never look like a saved one.
      if (!pendingWrite.current) pendingWrite.current = job
      setSaveState('error')
      // Names the file rather than showing the raw thrown value — the full
      // "what's still safe / what to do" reassurance lives in SaveStatus's
      // tooltip, since this compact tab-bar chip has no room for two
      // sentences of visible text.
      setSaveError(`Couldn't save ${folderName(job.path)}`)
      console.error('save failed', e)
    }
  }, [scheduleIndex])

  const flush = useCallback(async () => {
    await flushSave()
    await flushIndex()
  }, [flushSave, flushIndex])

  const save = useCallback(
    (markdown: string) => {
      setContentAndRef(markdown)
      if (!path || !workspacePath) return
      pendingWrite.current = { path, workspace: workspacePath, content: markdown }
      setSaveState('dirty')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        if (incoming.current === null) void flushSave()
      }, saveDebounceMs)
    },
    [path, workspacePath, flushSave, saveDebounceMs, setContentAndRef],
  )

  // Dismissing only hides the message — the buffer stays dirty and will retry
  // on the next edit or flush, so an unsaved note never reads as saved.
  const dismissError = useCallback(() => {
    setSaveError(null)
    setSaveState(pendingWrite.current ? 'dirty' : 'clean')
  }, [])

  // An unmodified buffer follows the disk; a modified one never gets
  // overwritten silently — the user decides which version wins. Autosave stays
  // held while the prompt is up (`incoming` set), or it would clobber theirs.
  useEffect(() => {
    if (!path || !workspacePath) return
    const unlisten = listen<string[]>('workspace-changed', async (event) => {
      if (!event.payload.includes(path)) return
      const fresh = await api.notes.open(workspacePath, path)
      // Our own save echoes back through the watcher, possibly while the write
      // is still in flight. If the disk holds the buffer or anything we just
      // wrote, nobody else touched it — and any earlier prompt is stale.
      if (fresh === contentRef.current || recentWrites.current.includes(fresh)) {
        const held = incoming.current !== null
        incoming.current = null
        setConflict(false)
        if (held) void flushSave()
        return
      }
      if (pendingWrite.current || saveTimer.current) {
        incoming.current = fresh
        setConflict(true)
        return
      }
      setContentAndRef(fresh)
      setSaveState('clean')
    })
    return () => void unlisten.then((off) => off())
  }, [path, workspacePath, setContentAndRef, flushSave])

  const keepMine = useCallback(() => {
    incoming.current = null
    setConflict(false)
    void flushSave()
  }, [flushSave])

  const reloadTheirs = useCallback(() => {
    const fresh = incoming.current
    incoming.current = null
    setConflict(false)
    if (fresh === null) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    pendingWrite.current = null
    recentWrites.current = [fresh]
    setContentAndRef(fresh)
    setSaveState('clean')
    setSaveError(null)
  }, [setContentAndRef])

  // GC runs after the final flush, not on every keystroke — deleting an
  // orphaned image immediately would out-race ProseMirror's undo stack and
  // turn a ctrl+z into a broken image. Once the tab is gone, so is that undo
  // history, so closing is the first point it's safe to reap.
  useEffect(
    () => () => {
      const notePath = path
      // Captured now, synchronously — by the time flush() resolves, the
      // note being switched to (even "no note", i.e. Home) has already run
      // its own effect and reset contentRef.current for its own context.
      // Reading the ref inside the .then() below would gc this note's
      // assets against that other note's content instead of its own.
      const contentAtClose = contentRef.current
      void flush().then(() => {
        if (!notePath) return
        void api.assets.gc(notePath, contentAtClose).then(() => {
          useWorkspaceStore.getState().addGitPendingPath(sidecarDir(notePath, 'assets'))
        })
      })
    },
    [path, flush],
  )

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
    conflict,
    keepMine,
    reloadTheirs,
  }
}
