import { useEffect, useState } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { FolderTree } from './FolderTree'
import { buildFolderTree, noteFileName } from '../lib/folderTree'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

export function NoteList() {
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const canvases = useNotesStore((s) => s.canvases)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const folderError = useWorkspaceStore((s) => s.folderError)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const [tagFilteredNotes, setTagFilteredNotes] = useState<NoteMetadata[]>([])

  useEffect(() => {
    if (!tagFilter || !workspacePath) {
      setTagFilteredNotes([])
      return
    }
    let stale = false
    api.notes
      .notesWithTag(workspacePath, tagFilter)
      .then((found) => {
        if (!stale) setTagFilteredNotes(found)
      })
      .catch((err) => {
        if (stale) return
        setTagFilteredNotes([])
        setFolderError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      stale = true
    }
  }, [tagFilter, workspacePath, setFolderError])

  const tree = workspacePath ? buildFolderTree(workspacePath, folders, notes, canvases) : []

  return (
    <>
      {folderError && workspacePath && <p className="sidebar-error" role="alert">{folderError}</p>}
      {tagFilter ? (
        <ul className="folder-tree">
          {tagFilteredNotes.map((note) => (
            <li
              key={note.path}
              className="tree-row tree-note"
              tabIndex={0}
              onClick={() => openTab(note.path)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                openTab(note.path)
              }}
            >
              <span className="tree-label" title={noteFileName(note.path)}>{noteFileName(note.path)}</span>
            </li>
          ))}
        </ul>
      ) : workspacePath && tree.length === 0 ? (
        <p className="sidebar-onboarding">
          No notes yet — click <strong>+</strong> above, or Ctrl N, to create your first one.
        </p>
      ) : (
        <FolderTree entries={tree} />
      )}
    </>
  )
}
