import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import type { ErrorLogEntry } from '../types'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ErrorLogDialogProps {
  onClose: () => void
}

export function ErrorLogDialog({ onClose }: ErrorLogDialogProps) {
  const [entries, setEntries] = useState<ErrorLogEntry[]>([])

  useEffect(() => {
    void api.errorLog.list().then(setEntries)
  }, [])

  async function handleClear() {
    await api.errorLog.clear()
    setEntries([])
  }

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

        <div className="settings-panel-body error-log-list">
          {entries.length === 0 ? (
            <p className="template-empty-hint">No errors recorded.</p>
          ) : (
            entries.map((entry, i) => (
              <div key={i} className="error-log-entry">
                <span className="error-log-timestamp">{entry.timestamp}</span>
                <span className="error-log-source">{entry.source}</span>
                <span className="error-log-message">{entry.message}</span>
              </div>
            ))
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
