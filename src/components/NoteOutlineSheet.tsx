import { useEffect, useMemo, useState } from 'react'
import { useNote } from '../hooks/useNote'
import { parseHeadings } from '../lib/outlineHeadings'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { BacklinkEntry } from '../types'
import { jumpToHeading } from './OutlinePanel'

interface NoteOutlineSheetProps {
  notePath: string
  noteTitle: string
  onClose: () => void
}

export function NoteOutlineSheet({ notePath, noteTitle, onClose }: NoteOutlineSheetProps) {
  const { content } = useNote(notePath)
  const headings = useMemo(() => parseHeadings(content), [content])
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([])

  useEffect(() => {
    if (!workspacePath) return
    void api.notes.backlinksForWithContext(workspacePath, notePath).then(setBacklinks)
  }, [workspacePath, notePath])

  return (
    <>
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet" role="dialog" aria-label="Outline and backlinks">
        <div className="mobile-sheet-title">{noteTitle}</div>
        <p className="mobile-sheet-heading">Outline</p>
        {headings.length === 0 ? (
          <p className="mobile-sheet-empty">No headings in this note yet.</p>
        ) : (
          headings.map((h, i) => (
            <button
              key={i}
              className="mobile-sheet-action"
              style={{ paddingLeft: `calc(var(--space-md) + ${(h.level - 1) * 12}px)` }}
              onClick={() => {
                onClose()
                jumpToHeading(document.querySelector('.editor-pane'), i)
              }}
            >
              {h.text || '(untitled heading)'}
            </button>
          ))
        )}
        <p className="mobile-sheet-heading">Linked from ({backlinks.length})</p>
        {backlinks.length === 0 ? (
          <p className="mobile-sheet-empty">No notes link here yet.</p>
        ) : (
          backlinks.map(({ note }) => (
            <button
              key={note.path}
              className="mobile-sheet-action"
              onClick={() => {
                onClose()
                openTab(note.path)
              }}
            >
              {note.title}
            </button>
          ))
        )}
      </div>
    </>
  )
}
