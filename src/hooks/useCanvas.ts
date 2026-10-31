import { useState, useEffect, useCallback, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { parseCanvas, serializeCanvas, type Canvas } from '../lib/jsonCanvas'
import { mergeCanvas } from '../lib/canvasMerge'
import { folderName } from '../lib/pathPrefix'
import { SAVE_DEBOUNCE_MS, type SaveState } from './useNote'

const RECENT_WRITES = 4
const HISTORY_CAP = 100

interface DiskState {
  canvas: Canvas
  text: string
}

function passesOf(canvas: Canvas): Set<number> {
  return new Set(canvas.nodes.flatMap((n) => (typeof n.pass === 'number' ? [n.pass] : [])))
}

function newPasses(before: Canvas, after: Canvas): number[] {
  const known = passesOf(before)
  return [...passesOf(after)].filter((p) => !known.has(p)).sort((a, b) => a - b)
}

// `path` is fixed for the hook's lifetime: mount the pane with `key={path}`, so a
// tab switch unmounts (and flushes) this instance instead of re-pointing it.
export function useCanvas(path: string) {
  const workspace = useWorkspaceStore((s) => s.path)
  const [canvas, setCanvasState] = useState<Canvas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('clean')
  const [conflict, setConflict] = useState(false)
  const [appendedPasses, setAppendedPasses] = useState<number[]>([])
  const [history, setHistory] = useState({ undo: 0, redo: 0 })

  const canvasRef = useRef<Canvas | null>(null)
  // The last disk state we know of: the common ancestor for every merge.
  const base = useRef<DiskState | null>(null)
  const incoming = useRef<DiskState | null>(null)
  const dirty = useRef(false)
  const blocked = useRef(false)
  const recentWrites = useRef<string[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const undoStack = useRef<Canvas[]>([])
  const redoStack = useRef<Canvas[]>([])

  const setBuffer = useCallback((next: Canvas) => {
    canvasRef.current = next
    setCanvasState(next)
  }, [])

  const blockWith = useCallback((message: string | null) => {
    blocked.current = message !== null
    setError(message)
  }, [])

  const syncHistory = useCallback(() => {
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length })
  }, [])

  // Saves and external-change handling both read-modify-write the buffer across
  // awaits; running them one at a time keeps a save from racing a merge.
  const serial = useCallback(<T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(job)
    queue.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }, [])

  // Undo must never resurrect a state from before an agent's pass arrived (the
  // next save would delete that pass), so any external merge drops the history.
  const adopt = useCallback(
    (disk: DiskState, buffer: Canvas) => {
      const before = canvasRef.current
      base.current = disk
      incoming.current = null
      setConflict(false)
      undoStack.current = []
      redoStack.current = []
      syncHistory()
      setBuffer(buffer)
      if (before) setAppendedPasses(newPasses(before, buffer))
    },
    [setBuffer, syncHistory],
  )

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    api.notes
      .open(workspace, path)
      .then((text) => {
        if (cancelled) return
        const parsed = parseCanvas(text)
        if (!parsed.ok) {
          blockWith(`Couldn't read ${folderName(path)}: ${parsed.error}`)
          return
        }
        base.current = { canvas: parsed.canvas, text }
        setBuffer(parsed.canvas)
      })
      .catch((e: unknown) => {
        if (!cancelled) blockWith(`Could not open canvas: ${String(e)}`)
      })
    return () => {
      cancelled = true
    }
  }, [path, workspace, setBuffer, blockWith])

  const flushNow = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const known = base.current
    if (!workspace || !known || !dirty.current || blocked.current || incoming.current) return
    setSaveState('saving')
    try {
      const diskText = await api.notes.open(workspace, path)
      // Read the buffer only after the await: edits made while we were reading
      // the disk are part of this save, not lost to it.
      const mine = canvasRef.current
      if (!mine) return
      dirty.current = false
      let toWrite = mine
      if (diskText !== known.text) {
        const parsed = parseCanvas(diskText)
        if (!parsed.ok) {
          dirty.current = true
          blockWith(`Couldn't read ${folderName(path)}: ${parsed.error}`)
          setSaveState('error')
          return
        }
        const result = mergeCanvas(known.canvas, mine, parsed.canvas)
        if ('conflicts' in result) {
          dirty.current = true
          incoming.current = { canvas: parsed.canvas, text: diskText }
          setConflict(true)
          setSaveState('dirty')
          return
        }
        toWrite = result.merged
        adopt({ canvas: parsed.canvas, text: diskText }, toWrite)
      }
      const text = serializeCanvas(toWrite)
      recentWrites.current = [...recentWrites.current.slice(1 - RECENT_WRITES), text]
      await api.notes.save(workspace, path, text)
      base.current = { canvas: toWrite, text }
      useWorkspaceStore.getState().addGitPendingPath(path)
      setSaveState(dirty.current ? 'dirty' : 'clean')
    } catch (e) {
      dirty.current = true
      setSaveState('error')
      console.error('canvas save failed', e)
    }
  }, [workspace, path, adopt, blockWith])

  const flush = useCallback(() => serial(flushNow), [serial, flushNow])

  const commit = useCallback(
    (next: Canvas) => {
      setBuffer(next)
      dirty.current = true
      setSaveState('dirty')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
    },
    [setBuffer, flush],
  )

  const update = useCallback(
    (next: Canvas) => {
      const current = canvasRef.current
      if (!current || blocked.current) return
      undoStack.current = [...undoStack.current.slice(1 - HISTORY_CAP), current]
      redoStack.current = []
      syncHistory()
      commit(next)
    },
    [commit, syncHistory],
  )

  const undo = useCallback(() => {
    const current = canvasRef.current
    const previous = undoStack.current.pop()
    if (!current || !previous || blocked.current) return
    redoStack.current.push(current)
    syncHistory()
    commit(previous)
  }, [commit, syncHistory])

  const redo = useCallback(() => {
    const current = canvasRef.current
    const next = redoStack.current.pop()
    if (!current || !next || blocked.current) return
    undoStack.current.push(current)
    syncHistory()
    commit(next)
  }, [commit, syncHistory])

  useEffect(() => {
    if (!workspace) return
    const unlisten = listen<string[]>('canvas-changed', (event) => {
      if (!event.payload.includes(path)) return
      return serial(async () => {
        const text = await api.notes.open(workspace, path)
        const mine = canvasRef.current
        const known = base.current
        if (text === known?.text) return
        // Our own save echoes back through the watcher, possibly after we have
        // already edited again; nobody else touched the file in that case.
        if (recentWrites.current.includes(text) || (mine && text === serializeCanvas(mine))) {
          incoming.current = null
          setConflict(false)
          return
        }
        const parsed = parseCanvas(text)
        if (!parsed.ok) {
          blockWith(`Couldn't read ${folderName(path)}: ${parsed.error}`)
          return
        }
        blockWith(null)
        const disk = { canvas: parsed.canvas, text }
        if (!mine || !known || !dirty.current) {
          adopt(disk, disk.canvas)
          return
        }
        const result = mergeCanvas(known.canvas, mine, disk.canvas)
        if ('conflicts' in result) {
          incoming.current = disk
          setConflict(true)
          return
        }
        adopt(disk, result.merged)
      })
    })
    return () => void unlisten.then((off) => off())
  }, [workspace, path, serial, adopt, blockWith])

  const keepMine = useCallback(() => {
    if (incoming.current) base.current = incoming.current
    incoming.current = null
    setConflict(false)
    dirty.current = true
    void flush()
  }, [flush])

  const reloadTheirs = useCallback(() => {
    const theirs = incoming.current
    if (!theirs) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    dirty.current = false
    recentWrites.current = [theirs.text]
    adopt(theirs, theirs.canvas)
    setSaveState('clean')
  }, [adopt])

  useEffect(() => () => void flush(), [flush])

  useEffect(() => {
    const handler = () => void flush()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [flush])

  return {
    canvas,
    error,
    readOnly: error !== null,
    update,
    saveState,
    conflict,
    keepMine,
    reloadTheirs,
    appendedPasses,
    undo,
    redo,
    canUndo: history.undo > 0,
    canRedo: history.redo > 0,
  }
}
