import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { restoreFromTrash } from '../hooks/useTrash'
import type { TrashEntry } from '../types'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface TrashDialogProps {
  onClose: () => void
}

export function TrashDialog({ onClose }: TrashDialogProps) {
  const workspace = useWorkspaceStore((s) => s.path)
  const [entries, setEntries] = useState<TrashEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (workspace) void api.trash.list(workspace).then(setEntries)
  }, [workspace])

  async function run(action: () => Promise<void>) {
    try {
      await action()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function withoutEntry(id: string) {
    setEntries((all) => all.filter((e) => e.id !== id))
  }

  async function handleRestore(entry: TrashEntry) {
    if (!workspace) return
    await run(async () => {
      await restoreFromTrash(workspace, entry)
      withoutEntry(entry.id)
    })
  }

  async function handlePurge(entry: TrashEntry) {
    if (!(await confirm(`Permanently delete "${entry.name}"? This cannot be undone.`))) return
    await run(async () => {
      await api.trash.purge(entry.id)
      withoutEntry(entry.id)
    })
  }

  async function handleEmpty() {
    if (!workspace) return
    if (!(await confirm(`Permanently delete all ${entries.length} items in the trash? This cannot be undone.`))) return
    await run(async () => {
      await api.trash.empty(workspace)
      setEntries([])
    })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel trash-dialog" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Trash</h2>
          </DialogTitle>
          <button
            className="settings-panel-close"
            onClick={onClose}
            aria-label="Close trash"
            title="Close trash"
          >
            <X size={16} />
          </button>
        </div>

        <div className="settings-panel-body trash-list">
          {entries.length === 0 ? (
            <p className="template-empty-hint">Nothing in the trash.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="trash-entry">
                <div className="trash-entry-text">
                  <span className="trash-entry-name">{entry.name}</span>
                  <span className="trash-entry-meta" title={entry.originalPath}>
                    {new Date(entry.trashedAt).toLocaleString()} · {entry.originalPath}
                  </span>
                </div>
                <div className="trash-entry-actions">
                  <button className="trash-action" onClick={() => void handleRestore(entry)}>
                    Restore
                  </button>
                  <button className="trash-action danger" onClick={() => void handlePurge(entry)}>
                    Delete forever
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {error && <p className="template-empty-hint" role="alert">{error}</p>}

        {entries.length > 0 && (
          <div className="settings-panel-footer">
            <button className="settings-reset" onClick={() => void handleEmpty()}>
              Empty trash
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
