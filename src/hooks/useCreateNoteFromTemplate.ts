import { useCallback, useRef } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

// Mirrors useCreateNote exactly, except the file body is caller-supplied
// (a template with its placeholders already filled in) rather than a
// synthesized "# {title}" heading.
export function useCreateNoteFromTemplate() {
  const addNote = useNotesStore((s) => s.addNote)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const inFlight = useRef(false)

  return useCallback(
    async (title: string, content: string): Promise<NoteMetadata | null> => {
      if (!workspacePath || inFlight.current) return null
      inFlight.current = true
      try {
        const meta = await api.templates.createNote(
          workspacePath,
          selectedFolder ?? workspacePath,
          title,
          content,
        )
        addNote(meta)
        openTab(meta.path)
        setFolderError(null)
        return meta
      } catch (e) {
        setFolderError(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        inFlight.current = false
      }
    },
    [workspacePath, selectedFolder, addNote, openTab, setFolderError],
  )
}
