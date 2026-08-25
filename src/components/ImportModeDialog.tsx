import { FileImage, FileText } from 'lucide-react'
import type { PdfImportMode } from '../types'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ImportModeDialogProps {
  fileName: string
  initialMode: PdfImportMode
  onChoose: (mode: PdfImportMode) => void
  onCancel: () => void
}

export function ImportModeDialog({
  fileName,
  initialMode,
  onChoose,
  onCancel,
}: ImportModeDialogProps) {
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="import-mode-dialog" showCloseButton={false}>
        <DialogTitle asChild>
          <h2>Import {fileName}</h2>
        </DialogTitle>

        <button
          className={`import-mode-option${initialMode === 'markdown' ? ' preferred' : ''}`}
          onClick={() => onChoose('markdown')}
          autoFocus={initialMode === 'markdown'}
        >
          <FileText size={18} />
          <span>
            <strong>As Markdown</strong>
            <small>
              Converts the text layer into an editable, searchable note. Best for typeset
              exercise sheets and lecture notes.
            </small>
          </span>
        </button>

        <button
          className={`import-mode-option${initialMode === 'pages' ? ' preferred' : ''}`}
          onClick={() => onChoose('pages')}
          autoFocus={initialMode === 'pages'}
        >
          <FileImage size={18} />
          <span>
            <strong>As pages</strong>
            <small>
              Keeps each page as an image to annotate alongside. The only option that works
              for a scan.
            </small>
          </span>
        </button>

        <button className="import-mode-cancel" onClick={onCancel}>
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  )
}
