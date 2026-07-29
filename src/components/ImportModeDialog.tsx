import { FileImage, FileText } from 'lucide-react'
import type { PdfImportMode } from '../types'

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
    <div className="search-overlay" onMouseDown={onCancel}>
      <div className="import-mode-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Import {fileName}</h2>

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
      </div>
    </div>
  )
}
