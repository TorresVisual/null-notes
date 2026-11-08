import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from './workspace'
import { useSettingsStore } from './settings'
import { useDirtyPathsStore } from './dirtyPaths'
import { folderName, sidecarDir } from '../lib/pathPrefix'

export type SaveState = 'clean' | 'dirty' | 'saving' | 'error'

export const SAVE_DEBOUNCE_MS = 600
// Indexing is deliberately lazier than the file write: search may lag behind,
// the file on disk may not.
export const REINDEX_DEBOUNCE_MS = 2500
const RECENT_WRITES = 4

export interface NoteBuffer {
  content: string
  loadedPath: string | null
  failedPath: string | null
  isLoading: boolean
  saveState: SaveState
  saveError: string | null
  conflict: boolean
}

interface PendingWrite {
  path: string
  workspace: string
  content: string
}

interface Internal {
  path: string
  workspace: string | null
  refs: number
  closed: boolean
  content: string
  pendingWrite: PendingWrite | null
  pendingIndex: PendingWrite | null
  saveTimer: ReturnType<typeof setTimeout> | null
  indexTimer: ReturnType<typeof setTimeout> | null
  incoming: string | null
  recentWrites: string[]
  unlisten: Promise<() => void> | null
}

const EMPTY_BUFFER: NoteBuffer = {
  content: '',
  loadedPath: null,
  failedPath: null,
  isLoading: false,
  saveState: 'clean',
  saveError: null,
  conflict: false,
}

export const useNoteBuffers = create<{ buffers: Record<string, NoteBuffer> }>(() => ({ buffers: {} }))

const internals = new Map<string, Internal>()
// A path released and re-acquired before its flush lands must not read the
// disk until the flush has, or it would load the version before the last edit.
const closing = new Map<string, Promise<void>>()

function patch(n: Internal, partial: Partial<NoteBuffer>) {
  if (n.closed) return
  useNoteBuffers.setState((s) => ({
    buffers: { ...s.buffers, [n.path]: { ...(s.buffers[n.path] ?? EMPTY_BUFFER), ...partial } },
  }))
  if (partial.saveState) {
    const { markDirty, markClean } = useDirtyPathsStore.getState()
    if (partial.saveState === 'clean') markClean(n.path)
    else markDirty(n.path)
  }
}

function setContent(n: Internal, content: string, extra: Partial<NoteBuffer> = {}) {
  n.content = content
  patch(n, { content, ...extra })
}

async function flushIndex(n: Internal) {
  if (n.indexTimer) {
    clearTimeout(n.indexTimer)
    n.indexTimer = null
  }
  const job = n.pendingIndex
  if (!job) return
  n.pendingIndex = null
  try {
    await api.notes.reindex(job.path, job.workspace, job.content)
  } catch (e) {
    // The note itself is safe on disk; a stale index is recoverable, so
    // requeue quietly rather than alarming the user about their data.
    if (!n.pendingIndex) n.pendingIndex = job
    console.error('reindex failed', e)
  }
}

function scheduleIndex(n: Internal, job: PendingWrite) {
  n.pendingIndex = job
  if (n.indexTimer) clearTimeout(n.indexTimer)
  n.indexTimer = setTimeout(() => void flushIndex(n), REINDEX_DEBOUNCE_MS)
}

async function flushSave(n: Internal) {
  if (n.saveTimer) {
    clearTimeout(n.saveTimer)
    n.saveTimer = null
  }
  const job = n.pendingWrite
  if (!job) return
  n.pendingWrite = null
  patch(n, { saveState: 'saving' })
  n.recentWrites = [...n.recentWrites.slice(1 - RECENT_WRITES), job.content]
  try {
    await api.notes.save(job.workspace, job.path, job.content)
    useWorkspaceStore.getState().addGitPendingPath(job.path)
    if (!n.pendingWrite) patch(n, { saveState: 'clean', saveError: null })
    scheduleIndex(n, job)
  } catch (e) {
    // Keep the buffer dirty — a failed write must never look like a saved one.
    if (!n.pendingWrite) n.pendingWrite = job
    // Names the file rather than showing the raw thrown value — the full
    // "what's still safe / what to do" reassurance lives in SaveStatus's
    // tooltip, since this compact tab-bar chip has no room for two
    // sentences of visible text.
    patch(n, { saveState: 'error', saveError: `Couldn't save ${folderName(job.path)}` })
    console.error('save failed', e)
  }
}

async function flush(n: Internal) {
  await flushSave(n)
  await flushIndex(n)
}

// An unmodified buffer follows the disk; a modified one never gets
// overwritten silently — the user decides which version wins. Autosave stays
// held while the prompt is up (`incoming` set), or it would clobber theirs.
async function onWorkspaceChanged(n: Internal, workspace: string, changed: string[]) {
  if (!changed.includes(n.path)) return
  const fresh = await api.notes.open(workspace, n.path)
  if (n.closed) return
  // Our own save echoes back through the watcher, possibly while the write
  // is still in flight. If the disk holds the buffer or anything we just
  // wrote, nobody else touched it — and any earlier prompt is stale.
  if (fresh === n.content || n.recentWrites.includes(fresh)) {
    const held = n.incoming !== null
    n.incoming = null
    patch(n, { conflict: false })
    if (held) void flushSave(n)
    return
  }
  if (n.pendingWrite || n.saveTimer) {
    n.incoming = fresh
    patch(n, { conflict: true })
    return
  }
  setContent(n, fresh, { saveState: 'clean' })
}

async function load(n: Internal, workspace: string) {
  await closing.get(n.path)
  try {
    const text = await api.notes.open(workspace, n.path)
    setContent(n, text, { loadedPath: n.path })
  } catch (e) {
    // The buffer would otherwise still hold the previous note, and an edit
    // to it would be saved over this one. Unloaded stays unloaded: saveNote
    // drops everything until a real open succeeds.
    setContent(n, '', { failedPath: n.path, saveError: `Couldn't open note: ${String(e)}` })
  } finally {
    patch(n, { isLoading: false })
  }
}

export function acquireNote(path: string) {
  const existing = internals.get(path)
  if (existing) {
    existing.refs++
    return
  }
  const workspace = useWorkspaceStore.getState().path
  const n: Internal = {
    path,
    workspace,
    refs: 1,
    closed: false,
    content: '',
    pendingWrite: null,
    pendingIndex: null,
    saveTimer: null,
    indexTimer: null,
    incoming: null,
    recentWrites: [],
    unlisten: null,
  }
  internals.set(path, n)
  useNoteBuffers.setState((s) => ({
    buffers: { ...s.buffers, [path]: { ...EMPTY_BUFFER, isLoading: !!workspace } },
  }))
  if (!workspace) return
  n.unlisten = listen<string[]>('workspace-changed', (event) =>
    onWorkspaceChanged(n, workspace, event.payload),
  )
  void load(n, workspace)
}

export function releaseNote(path: string) {
  const n = internals.get(path)
  if (!n || --n.refs > 0) return
  // GC runs after the final flush, not on every keystroke — deleting an
  // orphaned image immediately would out-race ProseMirror's undo stack and
  // turn a ctrl+z into a broken image. Once the last tab is gone, so is that
  // undo history, so closing is the first point it's safe to reap.
  const loaded = useNoteBuffers.getState().buffers[path]?.loadedPath === path
  const contentAtClose = n.content
  internals.delete(path)
  n.closed = true
  useNoteBuffers.setState((s) => ({
    buffers: Object.fromEntries(Object.entries(s.buffers).filter(([p]) => p !== path)),
  }))
  useDirtyPathsStore.getState().markClean(path)
  void n.unlisten?.then((off) => off())
  const done = flush(n).then(async () => {
    if (!loaded) return
    await api.assets.gc(path, contentAtClose)
    useWorkspaceStore.getState().addGitPendingPath(sidecarDir(path, 'assets'))
  })
  const tracked = done.catch((e: unknown) => console.error('closing note failed', e)).finally(() => {
    if (closing.get(path) === tracked) closing.delete(path)
  })
  closing.set(path, tracked)
}

export function saveNote(path: string, markdown: string) {
  const n = internals.get(path)
  // Until the open lands, the buffer and the editor holding it belong to
  // nothing; pairing them with this path would overwrite the note with
  // whatever text the editor still shows.
  if (!n || !n.workspace || useNoteBuffers.getState().buffers[path]?.loadedPath !== path) return
  setContent(n, markdown, { saveState: 'dirty' })
  n.pendingWrite = { path, workspace: n.workspace, content: markdown }
  if (n.saveTimer) clearTimeout(n.saveTimer)
  n.saveTimer = setTimeout(() => {
    if (n.incoming === null) void flushSave(n)
  }, useSettingsStore.getState().settings.autosaveDebounceMs)
}

export async function flushNote(path: string) {
  const n = internals.get(path)
  if (n) await flush(n)
}

export async function flushAllNotes() {
  await Promise.all([...[...internals.values()].map(flush), ...closing.values()])
}

export function retrySaveNote(path: string) {
  const n = internals.get(path)
  return n ? flushSave(n) : Promise.resolve()
}

// Dismissing only hides the message — the buffer stays dirty and will retry
// on the next edit or flush, so an unsaved note never reads as saved.
export function dismissNoteError(path: string) {
  const n = internals.get(path)
  if (n) patch(n, { saveError: null, saveState: n.pendingWrite ? 'dirty' : 'clean' })
}

export function keepMine(path: string) {
  const n = internals.get(path)
  if (!n) return
  n.incoming = null
  patch(n, { conflict: false })
  void flushSave(n)
}

export function reloadTheirs(path: string) {
  const n = internals.get(path)
  if (!n) return
  const fresh = n.incoming
  n.incoming = null
  patch(n, { conflict: false })
  if (fresh === null) return
  if (n.saveTimer) {
    clearTimeout(n.saveTimer)
    n.saveTimer = null
  }
  n.pendingWrite = null
  n.recentWrites = [fresh]
  setContent(n, fresh, { saveState: 'clean', saveError: null })
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => void flushAllNotes())
}
