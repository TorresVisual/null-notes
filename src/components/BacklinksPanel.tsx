import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

interface BacklinksPanelProps {
  notePath: string
  noteTitle: string
}

export function BacklinksPanel({ notePath, noteTitle }: BacklinksPanelProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [backlinks, setBacklinks] = useState<NoteMetadata[]>([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!workspacePath) return
    api.notes.backlinksFor(workspacePath, noteTitle).then(setBacklinks)
    // notePath is included so switching between two notes that happen to
    // share a title still triggers a fresh fetch.
  }, [workspacePath, notePath, noteTitle])

  return (
    <div className="backlinks-panel">
      <button className="backlinks-toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />} Linked from ({backlinks.length})
      </button>
      {!collapsed && (
        backlinks.length === 0 ? (
          <p className="backlinks-empty">
            No notes link here yet.
            <span className="empty-state-detail">
              Write <code>[[{noteTitle}]]</code> in another note to connect it to this one.
            </span>
          </p>
        ) : (
          <ul className="backlinks-list">
            {backlinks.map((note) => (
              <li key={note.path}>
                <button className="backlink-item" onClick={() => openTab(note.path)}>
                  {note.title}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
