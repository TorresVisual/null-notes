import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import type { DueCard, Grade } from '../types'

interface ReviewSessionProps {
  onClose: () => void
}

const GRADES: Array<{ grade: Grade; label: string }> = [
  { grade: 'again', label: 'Again' },
  { grade: 'hard', label: 'Hard' },
  { grade: 'good', label: 'Good' },
  { grade: 'easy', label: 'Easy' },
]

export function ReviewSession({ onClose }: ReviewSessionProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const [queue, setQueue] = useState<DueCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    api.notes.listDueCards(workspacePath).then((cards) => {
      setQueue(cards)
      setIsLoading(false)
    })
  }, [workspacePath])

  const current = queue[0]

  // Grades the front card, then drops it from the local queue on success —
  // mirrors `TaskView.toggle`'s "drop it from local state, don't refetch"
  // shape, since the backend write already happened.
  function grade(g: Grade) {
    if (!workspacePath || !current) return
    void api.notes.gradeCard(current.notePath, current.position, g, workspacePath).then(() => {
      setQueue((prev) => prev.slice(1))
      setRevealed(false)
    })
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="review-session" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Review{queue.length > 0 ? ` (${queue.length} due)` : ''}</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close review">
            <X size={16} />
          </button>
        </div>
        {isLoading ? (
          <p className="status">Loading…</p>
        ) : !current ? (
          <p className="empty-state">All done for today.</p>
        ) : (
          <div className="review-card">
            <p className="review-card-note">{current.noteTitle}</p>
            <p className="review-card-front">{current.front}</p>
            {revealed ? (
              <>
                <p className="review-card-back">{current.back}</p>
                <div className="review-card-grades">
                  {GRADES.map(({ grade: g, label }) => (
                    <button key={g} className="review-card-grade" onClick={() => grade(g)}>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button className="review-card-reveal" onClick={() => setRevealed(true)}>
                Reveal answer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
