import { useCallback } from 'react'
import { useCreateNote } from './useCreateNote'
import { api } from '../lib/tauri'
import { isUntouchedQuickNote, quickNoteTitle } from '../lib/quickNote'
import { flushAllNotes, useNoteBuffers } from '../store/noteBuffers'
import { useMobileEditStore } from '../store/mobileEdit'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'

// Path → generated title, for notes this session's + button created. Only these
// are ever candidates for deletion, so no other note can be removed by leaving it.
const quickNotes = new Map<string, string>()

export function useQuickNote() {
  const createNote = useCreateNote()
  return useCallback(async () => {
    const meta = await createNote(quickNoteTitle(new Date()))
    if (!meta) return
    quickNotes.set(meta.path, meta.title)
    useMobileEditStore.getState().startEditing(meta.path)
  }, [createNote])
}

export async function discardIfUntouched(path: string) {
  const title = quickNotes.get(path)
  if (title === undefined) return
  // Decided and the tab closed before the first await, so a caller can leave the
  // editor right after calling this: the buffer vanishes when the editor unmounts.
  // Its content is the latest text; a pending debounced save does not change it.
  // An unloaded buffer proves nothing about the content, and deleting on a guess
  // would lose a note.
  const buffer = useNoteBuffers.getState().buffers[path]
  if (buffer?.loadedPath !== path) return
  if (!isUntouchedQuickNote(title, buffer.content)) return
  quickNotes.delete(path)
  const workspace = useWorkspaceStore.getState()
  if (!workspace.path) return
  // Close first and let the buffer's final flush and asset GC land, so neither
  // writes to a note that is already gone.
  workspace.closeTab(path)
  workspace.setActiveTab(null)
  await flushAllNotes()
  await api.notes.delete(workspace.path, path)
  useNotesStore.getState().removeNote(path)
}
