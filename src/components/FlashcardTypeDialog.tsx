import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface FlashcardTypeDialogProps {
  onPick: (stub: string) => void
  onClose: () => void
}

interface FlashcardType {
  label: string
  description: string
  stub: string
}

const FLASHCARD_TYPES: FlashcardType[] = [
  { label: 'Q&A', description: 'Free-response, self-graded', stub: 'Question :: Answer' },
  { label: 'Cloze', description: 'Fill-in-the-blank span', stub: 'Text with {{hidden}} span.' },
  {
    label: 'Multiple choice',
    description: 'One or more correct options, auto-graded',
    stub: 'Question ::\n- [ ] Option\n- [x] Correct option\n- [ ] Option',
  },
]

export function FlashcardTypeDialog({ onPick, onClose }: FlashcardTypeDialogProps) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Insert Flashcard</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="template-list">
          {FLASHCARD_TYPES.map((t) => (
            <button key={t.label} className="import-mode-option" onClick={() => onPick(t.stub)}>
              <span>
                <strong>{t.label}</strong>
                <small>{t.description}</small>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
