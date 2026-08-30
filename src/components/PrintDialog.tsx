import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import type { PrinterInfo } from '../types'

interface PrintDialogProps {
  onClose: () => void
}

export function PrintDialog({ onClose }: PrintDialogProps) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [selected, setSelected] = useState('')
  const [includeHeaderFooter, setIncludeHeaderFooter] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)

  useEffect(() => {
    void api.printing.listPrinters().then((list) => {
      setPrinters(list)
      setSelected(list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? '')
    })
  }, [])

  async function print() {
    if (isPrinting || !selected) return
    setIsPrinting(true)
    try {
      await api.printing.printDocument(selected, includeHeaderFooter)
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
      <DialogContent className="formula-sheet-prompt print-dialog" showCloseButton={false}>
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
          <button className="dialog-action-primary" onClick={() => void print()} disabled={isPrinting || !selected}>
            {isPrinting ? 'Printing…' : 'Print'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
