import { useCallback } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { inkApi } from '../lib/ink'
import { canvasNoteBody } from '../lib/canvasNote'
import type { NoteMetadata } from '../types'
import type { InkData } from '../ink/types'

// Fits the note column at 1x and grows downward as you write; zooming past
// the column width scrolls horizontally rather than clipping.
const EMPTY_PAGE: InkData = { width: 700, height: 1200, strokes: [], shapes: [] }

// Created as a real note first, then rewritten as a canvas body, so it picks
// up the same naming, indexing and folder rules as any other note. Shared by
// the sidebar button and the native menu.
export function useCreateCanvasNote() {
  const addNote = useNotesStore((s) => s.addNote)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)

  return useCallback(
    async (title: string): Promise<NoteMetadata | null> => {
      if (!workspacePath) return null
      const folder = selectedFolder ?? workspacePath
      try {
        const meta = await api.notes.create(workspacePath, folder, title)
        const dir = await inkApi.ensureDir(meta.path)
        const sep = dir.includes('\\') ? '\\' : '/'
        const svgPath = `${dir}${sep}page.svg`
        await inkApi.write(svgPath, EMPTY_PAGE)
        const body = canvasNoteBody(title, svgPath, EMPTY_PAGE.width, EMPTY_PAGE.height)
        await api.notes.save(meta.path, body)
        await api.notes.reindex(meta.path, workspacePath, body)
        addNote(meta)
        openTab(meta.path)
        setFolderError(null)
        return meta
      } catch (e) {
        setFolderError(e instanceof Error ? e.message : String(e))
        return null
      }
    },
    [workspacePath, selectedFolder, addNote, openTab, setFolderError],
  )
}
