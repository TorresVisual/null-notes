import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { parseBase, serializeBase } from '../lib/baseFile'
import type { BaseDoc, BaseFile } from '../lib/baseFile'
import { registerCanvasFlush } from '../lib/canvasFlush'
import { SAVE_DEBOUNCE_MS, type SaveState } from './useNote'

interface Parsed {
  doc: BaseDoc
  base: BaseFile
}

// `path` is fixed for the hook's lifetime: mount the pane with `key={path}`.
// A buffer that doesn't parse is never written, and a dirty buffer is never
// overwritten from disk — an outside change raises `conflict` instead.
export function useBase(path: string) {
  const workspace = useWorkspaceStore((s) => s.path)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [source, setSourceState] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('clean')
  const [conflict, setConflict] = useState(false)

  const disk = useRef<string | null>(null)
  const buffer = useRef('')
  const incoming = useRef<string | null>(null)
  const dirty = useRef(false)
  const blocked = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())

  const serial = useCallback(<T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(job)
    queue.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }, [])

  const adopt = useCallback((text: string) => {
    const result = parseBase(text)
    disk.current = text
    buffer.current = text
    incoming.current = null
    dirty.current = false
    setConflict(false)
    setSourceState(text)
    setSaveState('clean')
    if (result.ok) {
      blocked.current = false
      setParsed({ doc: result.doc, base: result.base })
      setError(null)
    } else {
      blocked.current = true
      setParsed(null)
      setError(result.error)
    }
  }, [])

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    api.notes
      .open(workspace, path)
      .then((text) => {
        if (!cancelled) adopt(text)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        blocked.current = true
        setError(`Couldn't open base: ${String(e)}`)
      })
    return () => {
      cancelled = true
    }
  }, [workspace, path, adopt])

  const flushNow = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!workspace || !dirty.current || blocked.current || incoming.current !== null) return
    setSaveState('saving')
    try {
      const onDisk = await api.notes.open(workspace, path)
      if (onDisk !== disk.current && onDisk !== buffer.current) {
        incoming.current = onDisk
        setConflict(true)
        setSaveState('dirty')
        return
      }
      const text = buffer.current
      dirty.current = false
      await api.notes.save(workspace, path, text)
      disk.current = text
      useWorkspaceStore.getState().addGitPendingPath(path)
      setSaveState(dirty.current ? 'dirty' : 'clean')
    } catch (e) {
      dirty.current = true
      setSaveState('error')
      console.error('base save failed', e)
    }
  }, [workspace, path])

  const flush = useCallback(() => serial(flushNow), [serial, flushNow])

  const markDirty = useCallback(() => {
    dirty.current = true
    setSaveState('dirty')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
  }, [flush])

  const update = useCallback(
    (change: (doc: BaseDoc) => void) => {
      if (!parsed || blocked.current) return
      change(parsed.doc)
      const text = serializeBase(parsed.doc)
      const result = parseBase(text)
      if (!result.ok) return
      buffer.current = text
      setSourceState(text)
      setParsed({ doc: result.doc, base: result.base })
      markDirty()
    },
    [parsed, markDirty],
  )

  const setSource = useCallback(
    (text: string) => {
      setSourceState(text)
      buffer.current = text
      const result = parseBase(text)
      if (!result.ok) {
        blocked.current = true
        setError(result.error)
        return
      }
      blocked.current = false
      setError(null)
      setParsed({ doc: result.doc, base: result.base })
      markDirty()
    },
    [markDirty],
  )

  useEffect(() => {
    if (!workspace) return
    const unlisten = listen<string[]>('canvas-changed', (event) => {
      if (!event.payload.includes(path)) return
      return serial(async () => {
        const text = await api.notes.open(workspace, path)
        if (text === disk.current) return
        if (text === buffer.current) {
          disk.current = text
          return
        }
        if (!dirty.current) {
          adopt(text)
          return
        }
        incoming.current = text
        setConflict(true)
      })
    })
    return () => void unlisten.then((off) => off())
  }, [workspace, path, serial, adopt])

  const keepMine = useCallback(() => {
    disk.current = incoming.current
    incoming.current = null
    setConflict(false)
    dirty.current = true
    void flush()
  }, [flush])

  const reloadTheirs = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (incoming.current !== null) adopt(incoming.current)
  }, [adopt])

  useEffect(() => () => void flush(), [flush])
  useEffect(() => registerCanvasFlush(flush), [flush])

  useEffect(() => {
    const handler = () => void flush()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [flush])

  return {
    base: parsed?.base ?? null,
    doc: parsed?.doc ?? null,
    error,
    saveState,
    conflict,
    update,
    keepMine,
    reloadTheirs,
    source,
    setSource,
  }
}
