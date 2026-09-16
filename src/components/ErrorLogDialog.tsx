import { useEffect, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { api } from '../lib/tauri'
import { writeToClipboard } from '../lib/clipboard'
import type { ErrorLogEntry } from '../types'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ErrorLogDialogProps {
  onClose: () => void
}

function entryText(entry: ErrorLogEntry): string {
  const header = `[${entry.timestamp}] ${entry.source}: ${entry.message}`
  return entry.context ? `${header}\n${entry.context}` : header
}

function ErrorLogRow({ entry }: { entry: ErrorLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  return (
    <div className="error-log-entry">
      <div className="error-log-entry-header">
        <span className="error-log-timestamp">{new Date(entry.timestamp).toLocaleString()}</span>
        <span className="error-log-source">{entry.source}</span>
        <div className="error-log-entry-actions">
          {entry.context && (
            <button
              type="button"
              className="error-log-expand"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Hide stack trace' : 'Show stack trace'}
            >
              <ChevronRight
                size={13}
                className={expanded ? 'error-log-expand-icon rotated' : 'error-log-expand-icon'}
              />
            </button>
          )}
          <button
            type="button"
            className={`error-log-copy${copied ? ' copied' : ''}`}
            onClick={() => {
              void writeToClipboard(entryText(entry)).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <p className="error-log-message">{entry.message}</p>
      {expanded && entry.context && <pre className="error-log-context">{entry.context}</pre>}
    </div>
  )
}

export function ErrorLogDialog({ onClose }: ErrorLogDialogProps) {
  const [entries, setEntries] = useState<ErrorLogEntry[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    void api.errorLog.list().then(setEntries)
  }, [])

  async function handleClear() {
    await api.errorLog.clear()
    setEntries([])
  }

  const query = filter.trim().toLowerCase()
  const filtered = query
    ? entries.filter((e) => `${e.source} ${e.message} ${e.context ?? ''}`.toLowerCase().includes(query))
    : entries

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel error-log-dialog" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Error log</h2>
          </DialogTitle>
          <button
            className="settings-panel-close"
            onClick={onClose}
            aria-label="Close error log"
            title="Close error log"
          >
            <X size={16} />
          </button>
        </div>

        {entries.length > 0 && (
          <input
            type="text"
            className="error-log-filter-input"
            placeholder="Filter by source or message…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter error log entries"
          />
        )}

        <div className="settings-panel-body error-log-list">
          {entries.length === 0 ? (
            <p className="template-empty-hint">No errors recorded.</p>
          ) : filtered.length === 0 ? (
            <p className="template-empty-hint">No errors match &ldquo;{filter.trim()}&rdquo;.</p>
          ) : (
            filtered.map((entry, i) => <ErrorLogRow key={i} entry={entry} />)
          )}
        </div>

        <div className="settings-panel-footer">
          <button className="settings-reset" onClick={() => void handleClear()}>
            Clear log
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
