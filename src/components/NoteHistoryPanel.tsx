import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import type { SaveState } from '../hooks/useNote'
import type { NoteHistoryEntry } from '../types'

interface NoteHistoryPanelProps {
  notePath: string
  saveState: SaveState
  onRestore: (content: string) => void
}

export function NoteHistoryPanel({ notePath, saveState, onRestore }: NoteHistoryPanelProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const [entries, setEntries] = useState<NoteHistoryEntry[]>([])
  const [collapsed, setCollapsed] = useState(true)
  const [selected, setSelected] = useState<NoteHistoryEntry | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspacePath) return
    setListError(null)
    api.git
      .listNoteHistory(workspacePath, notePath)
      .then(setEntries)
      .catch((e: unknown) => setListError(`Couldn't load history: ${String(e)}`))
    setSelected(null)
    setPreview(null)
    setPreviewError(null)
  }, [workspacePath, notePath])

  async function handleSelect(entry: NoteHistoryEntry) {
    if (!workspacePath) return
    setSelected(entry)
    setPreview(null)
    setPreviewError(null)
    try {
      const content = await api.git.readNoteAtCommit(workspacePath, notePath, entry.sha)
      setPreview(content)
    } catch (e) {
      setPreviewError(`Couldn't load that version: ${String(e)}`)
    }
  }

  async function handleRestore() {
    if (preview === null) return
    if (saveState !== 'clean') {
      const proceed = await confirm('You have unsaved changes — restoring will discard them.')
      if (!proceed) return
    }
    onRestore(preview)
  }

  return (
    <div className="note-history-panel">
      <button className="note-history-toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />} History ({entries.length})
      </button>
      {!collapsed && (
        listError ? (
          <p className="note-history-error">{listError}</p>
        ) : entries.length === 0 ? (
          <p className="note-history-empty">
            No history yet — this note hasn&apos;t been committed.
          </p>
        ) : (
          <>
            <ul className="note-history-list">
              {entries.map((entry) => (
                <li key={entry.sha}>
                  <button
                    className="note-history-item"
                    onClick={() => void handleSelect(entry)}
                  >
                    <span className="note-history-timestamp">
                      {new Date(entry.timestampMs).toLocaleString()}
                    </span>
                    <span className="note-history-message">{entry.message}</span>
                  </button>
                </li>
              ))}
            </ul>
            {selected && previewError && (
              <p className="note-history-error">{previewError}</p>
            )}
            {selected && preview !== null && (
              <div className="note-history-preview">
                <pre>{preview}</pre>
                <button className="note-history-restore" onClick={() => void handleRestore()}>
                  Restore this version
                </button>
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}
