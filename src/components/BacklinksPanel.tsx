import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { setPendingHighlight } from '../lib/pendingHighlight'
import type { BacklinkEntry } from '../types'

interface BacklinksPanelProps {
  notePath: string
  noteTitle: string
}

export function BacklinksPanel({ notePath, noteTitle }: BacklinksPanelProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([])
  const [unlinkedMentions, setUnlinkedMentions] = useState<BacklinkEntry[]>([])
  const [collapsed, setCollapsed] = useState(true)
  const [mentionsCollapsed, setMentionsCollapsed] = useState(true)

  useEffect(() => {
    if (!workspacePath) return
    api.notes.backlinksForWithContext(workspacePath, notePath).then(setBacklinks)
    api.notes
      .unlinkedMentionsForWithContext(workspacePath, noteTitle, notePath)
      .then(setUnlinkedMentions)
    // notePath is included so switching between two notes that happen to
    // share a title still triggers a fresh fetch.
  }, [workspacePath, notePath, noteTitle])

  // Same open-and-jump plumbing SearchModal uses for a search result: stash
  // the text to find, then dispatch the event NoteEditor listens for in case
  // it's already mounted for this path (openTab alone wouldn't re-trigger it).
  function openMention(path: string) {
    openTab(path)
    setPendingHighlight(path, noteTitle)
    window.dispatchEvent(new Event('search:jump'))
  }

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
            {backlinks.map(({ note, snippet }) => (
              <li key={note.path}>
                <button className="backlink-item" onClick={() => openTab(note.path)}>
                  <span className="backlink-title">{note.title}</span>
                  {snippet && <span className="backlink-snippet">{snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      <button className="backlinks-toggle" onClick={() => setMentionsCollapsed((c) => !c)}>
        {mentionsCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />} Unlinked mentions (
        {unlinkedMentions.length})
      </button>
      {!mentionsCollapsed && (
        unlinkedMentions.length === 0 ? (
          <p className="backlinks-empty">No unlinked mentions found.</p>
        ) : (
          <ul className="backlinks-list">
            {unlinkedMentions.map(({ note, snippet }) => (
              <li key={note.path}>
                <button className="backlink-item" onClick={() => openMention(note.path)}>
                  <span className="backlink-title">{note.title}</span>
                  {snippet && <span className="backlink-snippet">{snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
