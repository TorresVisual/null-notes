import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { X } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { usePrintPreview } from '../hooks/usePrintPreview'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ExportPdfDialogProps {
  noteTitle: string
  contentRef: RefObject<HTMLElement | null>
  onClose: () => void
}

export function ExportPdfDialog({ noteTitle, contentRef, onClose }: ExportPdfDialogProps) {
  const {
    containerRef,
    showPageNumber,
    setShowPageNumber,
    showTitle,
    setShowTitle,
    showDate,
    setShowDate,
    isRendering,
    error,
    printPages,
  } = usePrintPreview(contentRef, noteTitle)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    if (error) showToast(error)
  }, [error])

  async function chooseAndExport() {
    if (isExporting || isRendering) return
    const path = await save({
      defaultPath: `${noteTitle}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!path) return
    setIsExporting(true)
    try {
      await printPages(() => api.printing.exportPdf(path))
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
      <DialogContent className="formula-sheet-prompt print-preview-dialog" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Export to PDF</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="print-preview-checkboxes">
          <label className="print-options-checkbox">
            <input
              type="checkbox"
              checked={showPageNumber}
              onChange={(e) => setShowPageNumber(e.target.checked)}
            />
            Page numbers
          </label>
          <label className="print-options-checkbox">
            <input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} />
            Title
          </label>
          <label className="print-options-checkbox">
            <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} />
            Date
          </label>
        </div>
        <div className="print-preview-pages" ref={containerRef} />
        <div className="formula-sheet-prompt-actions">
          <button className="dialog-action" onClick={onClose}>Cancel</button>
          <button
            className="dialog-action-primary"
            onClick={() => void chooseAndExport()}
            disabled={isExporting || isRendering}
          >
            {isExporting ? 'Exporting…' : 'Choose Location & Export…'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
