import { useCallback, useRef } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

// Creates a note in the selected folder, adds it to the store and opens it.
// Returns null when there is no workspace or the write failed — a failure is
// reported through the workspace error banner rather than thrown, since both
// call sites (sidebar button, unresolved wiki-link) are fire-and-forget clicks.
//
// `content` distinguishes a plain create (synthesized "# {title}" heading,
// the default) from useCreateNoteFromTemplate's caller-supplied body — only
// the plain path flashes the new tab and expands its folder, since a template
// insert already has the user's attention on the dialog that triggered it.
export function useCreateNote() {
  const addNote = useNotesStore((s) => s.addNote)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const expandFolder = useWorkspaceStore((s) => s.expandFolder)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const setFlashTabPath = useWorkspaceStore((s) => s.setFlashTabPath)
  const inFlight = useRef(false)

  return useCallback(
    async (title: string, content?: string): Promise<NoteMetadata | null> => {
      if (!workspacePath || inFlight.current) return null
      inFlight.current = true
      try {
        const folder = selectedFolder ?? workspacePath
        const meta =
          content === undefined
            ? await api.notes.create(workspacePath, folder, title)
            : await api.templates.createNote(workspacePath, folder, title, content)
        addNote(meta)
        openTab(meta.path)
        if (content === undefined) {
          setFlashTabPath(meta.path)
          // A collapsed target folder (freshly created, or re-collapsed while
          // still selected) would otherwise hide the note the instant it's
          // created — there'd be nothing on screen to show for the action.
          expandFolder(folder)
        }
        setFolderError(null)
        return meta
      } catch (e) {
        setFolderError(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        inFlight.current = false
      }
    },
    [workspacePath, selectedFolder, addNote, openTab, expandFolder, setFolderError, setFlashTabPath],
  )
}
