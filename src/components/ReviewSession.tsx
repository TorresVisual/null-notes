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
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [mcResult, setMcResult] = useState<number[] | null>(null)

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    api.notes.listDueCards(workspacePath).then((cards) => {
      setQueue(cards)
      setIsLoading(false)
    })
  }, [workspacePath])

  const current = queue[0]

  // Resets per-card UI state whenever the front card changes — including
  // right after grading, since a new due-queue fetch always produces a new
  // `current` object even if the same note comes up again.
  useEffect(() => {
    setPicked(new Set())
    setMcResult(null)
  }, [current?.notePath, current?.position])

  function refetch() {
    if (!workspacePath) return
    api.notes.listDueCards(workspacePath).then((cards) => {
      setQueue(cards)
      setRevealed(false)
    })
  }

  // Grades the front card, then re-fetches the whole due queue — unlike
  // `TaskView.toggle`'s "drop it from local state" shortcut, a card's
  // position is a line number, and grading writes a schedule-comment line
  // into the note. If another due card sits later in the same note, that
  // insertion shifts its own position too, so the locally cached queue can
  // no longer be trusted after any grade — only a fresh read reflects it.
  function grade(g: Grade) {
    if (!workspacePath || !current) return
    // Grading can fail if the note was deleted outside the app (the backend
    // then drops its stale queue entry on its own) — refetch regardless so a
    // ghost card can't get stuck un-gradeable forever.
    void api.notes
      .gradeCard(current.notePath, current.position, g, workspacePath)
      .catch(() => {})
      .then(refetch)
  }

  function togglePick(i: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function submitMc() {
    if (!workspacePath || !current) return
    void api.notes
      .gradeMcCard(current.notePath, current.position, Array.from(picked), workspacePath)
      .then((result) => setMcResult(result.correct))
  }

  function optionClass(i: number): string {
    if (!mcResult) return ''
    const isPicked = picked.has(i)
    const isCorrect = mcResult.includes(i)
    if (isPicked && isCorrect) return ' review-card-option-correct'
    if (isPicked && !isCorrect) return ' review-card-option-incorrect'
    if (!isPicked && isCorrect) return ' review-card-option-missed'
    return ''
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="review-session" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Review{queue.length > 0 ? ` (${queue.length} due)` : ''}</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close review" title="Close review">
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
            {current.kind === 'mc' ? (
              <>
                <ul className="review-card-options">
                  {current.options.map((opt, i) => (
                    <li key={i} className={`review-card-option${optionClass(i)}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={picked.has(i)}
                          disabled={mcResult !== null}
                          onChange={() => togglePick(i)}
                          aria-label={opt}
                        />
                        {opt}
                      </label>
                    </li>
                  ))}
                </ul>
                {mcResult === null ? (
                  <button className="review-card-reveal" disabled={picked.size === 0} onClick={submitMc}>
                    Submit
                  </button>
                ) : (
                  <button className="review-card-reveal" onClick={refetch}>
                    Next
                  </button>
                )}
              </>
            ) : revealed ? (
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
