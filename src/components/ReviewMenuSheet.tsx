import { ExternalLink, PauseCircle } from 'lucide-react'

interface ReviewMenuSheetProps {
  onClose: () => void
  onOpenNote: (() => void) | null
  onSuspend: (() => void) | null
  allWorkspaces: boolean | null
  onToggleAllWorkspaces: (next: boolean) => void
}

export function ReviewMenuSheet({
  onClose,
  onOpenNote,
  onSuspend,
  allWorkspaces,
  onToggleAllWorkspaces,
}: ReviewMenuSheetProps) {
  return (
    <>
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet" role="dialog" aria-label="Review options">
        {onOpenNote && (
          <button className="mobile-sheet-action" onClick={onOpenNote}>
            <ExternalLink size={18} /> Open note
          </button>
        )}
        {onSuspend && (
          <button className="mobile-sheet-action" onClick={onSuspend}>
            <PauseCircle size={18} /> Suspend card
          </button>
        )}
        {allWorkspaces !== null && (
          <label className="mobile-sheet-action review-menu-toggle">
            <span>Review all workspaces</span>
            <input
              type="checkbox"
              checked={allWorkspaces}
              onChange={(e) => onToggleAllWorkspaces(e.target.checked)}
            />
          </label>
        )}
      </div>
    </>
  )
}
