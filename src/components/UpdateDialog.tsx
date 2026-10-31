import { useState } from 'react'
import { useUpdateCheck } from '../hooks/useUpdateCheck'
import { useUpdateStore } from '../store/update'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

export function UpdateDialog() {
  useUpdateCheck()
  const update = useUpdateStore((s) => s.update)
  const dialogOpen = useUpdateStore((s) => s.dialogOpen)
  const dismiss = useUpdateStore((s) => s.closeDialog)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!update || !dialogOpen) return null

  async function install() {
    setInstalling(true)
    setError(null)
    try {
      // Windows quits the app itself once the installer starts.
      await update?.downloadAndInstall()
    } catch (e) {
      setError(String(e))
      setInstalling(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !installing && dismiss()}>
      <DialogContent className="settings-panel update-dialog" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Update available — v{update.version}</h2>
          </DialogTitle>
        </div>

        <div className="settings-panel-body">
          {update.body ? (
            <pre className="update-notes">{update.body}</pre>
          ) : (
            <p className="template-empty-hint">No release notes.</p>
          )}
          {error && <p className="settings-error">{error}</p>}
        </div>

        <div className="settings-panel-footer update-actions">
          <button className="settings-reset" onClick={dismiss} disabled={installing}>
            Later
          </button>
          <button className="settings-reset update-install" onClick={() => void install()} disabled={installing}>
            {installing ? 'Installing…' : 'Install and restart'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
