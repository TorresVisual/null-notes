import { useState } from 'react'
import { X } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ExportPdfDialogProps {
  noteTitle: string
  onClose: () => void
}

export function ExportPdfDialog({ noteTitle, onClose }: ExportPdfDialogProps) {
  const [includeHeaderFooter, setIncludeHeaderFooter] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  async function chooseAndExport() {
    if (isExporting) return
    const path = await save({
      defaultPath: `${noteTitle}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!path) return
    setIsExporting(true)
    try {
      await api.printing.exportPdf(path, includeHeaderFooter)
      showToast(`Exported "${noteTitle}.pdf"`)
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="formula-sheet-prompt export-pdf-dialog" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Export to PDF</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <label className="print-options-checkbox">
          <input
            type="checkbox"
            checked={includeHeaderFooter}
            onChange={(e) => setIncludeHeaderFooter(e.target.checked)}
          />
          Include page numbers, date, and title
        </label>
        <div className="formula-sheet-prompt-actions">
          <button className="dialog-action" onClick={onClose}>Cancel</button>
          <button className="dialog-action-primary" onClick={() => void chooseAndExport()} disabled={isExporting}>
            {isExporting ? 'Exporting…' : 'Choose Location & Export…'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
