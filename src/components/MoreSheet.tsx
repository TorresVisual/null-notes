import { GraduationCap, Layers, ListChecks, Network, RefreshCw, Settings, SquareFunction, type LucideIcon } from 'lucide-react'
import type { OverlayKind } from '../hooks/useOverlayManager'

interface Item {
  kind: OverlayKind
  label: string
  icon: LucideIcon
}

const ITEMS: Item[] = [
  { kind: 'deck', label: 'Deck & cram', icon: Layers },
  { kind: 'task', label: 'Tasks', icon: ListChecks },
  { kind: 'graph', label: 'Graph view', icon: Network },
  { kind: 'formulaSheet', label: 'Formula sheet', icon: SquareFunction },
  { kind: 'settings', label: 'Settings', icon: Settings },
]

interface MoreSheetProps {
  onClose: () => void
  onSelect: (kind: OverlayKind) => void
  onReview: () => void
  onSyncNow: (() => void) | null
  syncing: boolean
}

export function MoreSheet({ onClose, onSelect, onReview, onSyncNow, syncing }: MoreSheetProps) {
  return (
    <>
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet" role="dialog" aria-label="More">
        <button className="mobile-sheet-action" onClick={onReview}>
          <GraduationCap size={18} /> Review
        </button>
        {ITEMS.map(({ kind, label, icon: Icon }) => (
          <button key={kind} className="mobile-sheet-action" onClick={() => onSelect(kind)}>
            <Icon size={18} /> {label}
          </button>
        ))}
        {onSyncNow && (
          <button className="mobile-sheet-action" disabled={syncing} onClick={onSyncNow}>
            <RefreshCw size={18} className={syncing ? 'spin' : ''} /> Sync now
          </button>
        )}
      </div>
    </>
  )
}
