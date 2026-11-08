import { useEffect } from 'react'
import {
  acquireNote,
  releaseNote,
  saveNote,
  flushNote,
  retrySaveNote,
  dismissNoteError,
  keepMine,
  reloadTheirs,
  useNoteBuffers,
  SAVE_DEBOUNCE_MS,
  REINDEX_DEBOUNCE_MS,
  type SaveState,
} from '../store/noteBuffers'

export { SAVE_DEBOUNCE_MS, REINDEX_DEBOUNCE_MS }
export type { SaveState }

export function useNote(path: string | null) {
  const buffer = useNoteBuffers((s) => (path ? s.buffers[path] : undefined))

  useEffect(() => {
    if (!path) return
    acquireNote(path)
    return () => releaseNote(path)
  }, [path])

  return {
    content: buffer?.content ?? '',
    save: (markdown: string) => {
      if (path) saveNote(path, markdown)
    },
    isLoading:
      path !== null &&
      (buffer === undefined ||
        buffer.isLoading ||
        (buffer.loadedPath !== path && buffer.failedPath !== path)),
    saveState: buffer?.saveState ?? 'clean',
    saveError: buffer?.saveError ?? null,
    flush: async () => {
      if (path) await flushNote(path)
    },
    retrySave: async () => {
      if (path) await retrySaveNote(path)
    },
    dismissError: () => {
      if (path) dismissNoteError(path)
    },
    conflict: buffer?.conflict ?? false,
    keepMine: () => {
      if (path) keepMine(path)
    },
    reloadTheirs: () => {
      if (path) reloadTheirs(path)
    },
  }
}
