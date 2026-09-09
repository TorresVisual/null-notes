import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { LoadingStatus } from './LoadingStatus'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { CardText } from './CardText'
import type { DueCard, Grade } from '../types'

export type ReviewMode = { kind: 'due' } | { kind: 'cram'; streak: number }

interface ReviewSessionProps {
  onClose: () => void
  mode?: ReviewMode
}

const GRADES: Array<{ grade: Grade; label: string }> = [
  { grade: 'again', label: 'Again' },
  { grade: 'hard', label: 'Hard' },
  { grade: 'good', label: 'Good' },
  { grade: 'easy', label: 'Easy' },
]

// Good enough for study-order randomization — no seeding/fairness
// requirement, this is a shuffled drill order, not anything scored.
function shuffleCards(cards: DueCard[]): DueCard[] {
  return [...cards].sort(() => Math.random() - 0.5)
}

function shuffledIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, index) => index)
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const selected = indices[index]!
    indices[index] = indices[randomIndex]!
    indices[randomIndex] = selected
  }
  return indices
}

export function ReviewSession({ onClose, mode = { kind: 'due' } }: ReviewSessionProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const cramStreak = mode.kind === 'cram' ? mode.streak : null
  const [queue, setQueue] = useState<DueCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [mcResult, setMcResult] = useState<number[] | null>(null)
  const [mcSubmitting, setMcSubmitting] = useState(false)

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    setError(null)
    const request =
      cramStreak !== null
        ? api.notes.listCramCards(workspacePath, cramStreak)
        : api.notes.listDueCards(workspacePath)
    request
      .then((fetched) => setQueue(cramStreak !== null ? shuffleCards(fetched) : fetched))
      .catch((e: unknown) => setError(`Couldn't load the review queue: ${String(e)}`))
      .finally(() => setIsLoading(false))
  }, [workspacePath, cramStreak])

  const current = queue[0]
  const optionOrder = useMemo(
    () => (current?.kind === 'mc' ? shuffledIndices(current.options.length) : []),
    [current],
  )

  // Resets per-card UI state whenever the front card changes — including
  // right after grading, since a new due-queue fetch always produces a new
  // `current` object even if the same note comes up again.
  useEffect(() => {
    setPicked(new Set())
    setMcResult(null)
  }, [current?.notePath, current?.position])

  function refetch() {
    if (!workspacePath) return
    const request =
      cramStreak !== null
        ? api.notes.listCramCards(workspacePath, cramStreak)
        : api.notes.listDueCards(workspacePath)
    request.then((fetched) => {
      setQueue(cramStreak !== null ? shuffleCards(fetched) : fetched)
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
    const notePath = current.notePath
    // Grading can fail if the note was deleted outside the app (the backend
    // then drops its stale queue entry on its own) — refetch regardless so a
    // ghost card can't get stuck un-gradeable forever.
    void api.notes
      .gradeCard(notePath, current.position, g, workspacePath)
      .then(() => useWorkspaceStore.getState().addGitPendingPath(notePath))
      .catch(() => {})
      .finally(refetch)
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
    const notePath = current.notePath
    setMcSubmitting(true)
    void api.notes
      .gradeMcCard(notePath, current.position, Array.from(picked), workspacePath)
      .then((result) => {
        useWorkspaceStore.getState().addGitPendingPath(notePath)
        setMcResult(result.correct)
      })
      .catch(() => {
        // Same reasoning as grade(): the note may have been deleted outside
        // the app, or another card in it graded first and shifted this
        // card's position — refetch so a ghost card can't get stuck
        // un-gradeable forever.
        refetch()
      })
      .finally(() => setMcSubmitting(false))
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
          <h2>
            {cramStreak !== null
              ? `Cram — Category ${cramStreak}${queue.length > 0 ? ` (${queue.length} left)` : ''}`
              : `Review${queue.length > 0 ? ` (${queue.length} due)` : ''}`}
          </h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close review" title="Close review">
            <X size={16} />
          </button>
        </div>
        {isLoading ? (
          <LoadingStatus />
        ) : error ? (
          <p className="empty-state">{error}</p>
        ) : !current ? (
          <p className="empty-state">
            {cramStreak !== null ? 'No cards in this category.' : 'All done for today.'}
          </p>
        ) : (
          <div className="review-card">
            <p className="review-card-note">{current.noteTitle}</p>
            <p className="review-card-front">
              <CardText text={current.front} notePath={current.notePath} />
            </p>
            {current.kind === 'mc' ? (
              <>
                <ul className="review-card-options">
                  {optionOrder.map((optionIndex) => {
                    const opt = current.options[optionIndex]!
                    return (
                      <li key={optionIndex} className={`review-card-option${optionClass(optionIndex)}`}>
                        <label>
                          <input
                            type="checkbox"
                            checked={picked.has(optionIndex)}
                            disabled={mcResult !== null}
                            onChange={() => togglePick(optionIndex)}
                            aria-label={opt}
                          />
                          <CardText text={opt} notePath={current.notePath} />
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {mcResult === null ? (
                  <button
                    className="review-card-reveal"
                    disabled={picked.size === 0 || mcSubmitting}
                    onClick={submitMc}
                  >
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
                <p className="review-card-back">
                  <CardText text={current.back} notePath={current.notePath} />
                </p>
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
