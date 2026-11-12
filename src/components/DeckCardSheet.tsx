import { ExternalLink, PauseCircle, PlayCircle } from 'lucide-react'
import type { CardSummary } from '../types'

interface DeckCardSheetProps {
  card: CardSummary
  onClose: () => void
  onOpenNote: () => void
  onToggleSuspend: () => void
}

export function DeckCardSheet({ card, onClose, onOpenNote, onToggleSuspend }: DeckCardSheetProps) {
  return (
    <>
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet" role="dialog" aria-label="Card options">
        <div className="mobile-sheet-title">{card.front}</div>
        <button className="mobile-sheet-action" onClick={onOpenNote}>
          <ExternalLink size={18} /> Open in note
        </button>
        <button className="mobile-sheet-action" onClick={onToggleSuspend}>
          {card.suspended ? <PlayCircle size={18} /> : <PauseCircle size={18} />}
          {card.suspended ? 'Unsuspend card' : 'Suspend card'}
        </button>
      </div>
    </>
  )
}
