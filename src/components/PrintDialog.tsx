import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { usePrintPreview } from '../hooks/usePrintPreview'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import type { PrinterInfo } from '../types'

interface PrintDialogProps {
  noteTitle: string
  contentRef: RefObject<HTMLElement | null>
  onClose: () => void
}

export function PrintDialog({ noteTitle, contentRef, onClose }: PrintDialogProps) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [selected, setSelected] = useState('')
  const [isPrinting, setIsPrinting] = useState(false)
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

  useEffect(() => {
    void api.printing.listPrinters().then((list) => {
      setPrinters(list)
      setSelected(list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? '')
    })
  }, [])

  useEffect(() => {
    if (error) showToast(error)
  }, [error])

  async function print() {
    if (isPrinting || isRendering || !selected) return
    setIsPrinting(true)
    try {
      await printPages(() => api.printing.printDocument(selected))
      showToast('Sent to printer')
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e))
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="formula-sheet-prompt print-preview-dialog" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Print</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <label className="print-dialog-row">
          Printer
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {printers.length === 0 && <option value="">No printers found</option>}
            {printers.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
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
            onClick={() => void print()}
            disabled={isPrinting || isRendering || !selected}
          >
            {isPrinting ? 'Printing…' : 'Print'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
