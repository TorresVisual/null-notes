import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { LoadingStatus } from './LoadingStatus'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { CardText } from './CardText'
import { groupCardsByStreak, type CardStreakGroup } from '../lib/cardGroups'
import type { DueCard, Grade } from '../types'

export type ReviewMode =
  | { kind: 'due' }
  | { kind: 'cram'; streak: number; struggling: boolean }
  | { kind: 'tags'; tags: string[] }

interface ReviewSessionProps {
  onClose: () => void
  mode?: ReviewMode
  onSwitchCategory?: (streak: number, struggling: boolean) => void
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

export function ReviewSession({ onClose, mode = { kind: 'due' }, onSwitchCategory }: ReviewSessionProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const cramStreak = mode.kind === 'cram' ? mode.streak : null
  const cramStruggling = mode.kind === 'cram' && mode.struggling
  // A string, not the array: Layout builds a fresh mode object each render, so
  // an array in an effect's deps would refetch on every one.
  const tagsKey = mode.kind === 'tags' ? mode.tags.join(',') : null
  const [queue, setQueue] = useState<DueCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [mcResult, setMcResult] = useState<number[] | null>(null)
  const [mcSubmitting, setMcSubmitting] = useState(false)
  const [categories, setCategories] = useState<CardStreakGroup[]>([])
  const [allWorkspaces, setAllWorkspaces] = useState(false)

  // Lets the header offer a one-click switch to another category without
  // leaving the review overlay — Deck View computes the same buckets, but
  // going back there and clicking Cram again was the whole friction (#27).
  useEffect(() => {
    if (!workspacePath || cramStreak === null) return
    api.notes
      .listAllCards(workspacePath)
      .then((cards) => setCategories(groupCardsByStreak(cards)))
      .catch(() => {})
  }, [workspacePath, cramStreak])

  // Cram and tag sessions are drills over cards that aren't necessarily due,
  // so they're shuffled; the due queue keeps the backend's due-date order.
  async function fetchQueue(workspace: string): Promise<DueCard[]> {
    if (cramStreak !== null) {
      return shuffleCards(await api.notes.listCramCards(workspace, cramStreak, cramStruggling))
    }
    if (tagsKey !== null) {
      return shuffleCards(await api.notes.listTagCards(workspace, tagsKey.split(',')))
    }
    return api.notes.listDueCards(workspace, allWorkspaces)
  }

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    setError(null)
    fetchQueue(workspacePath)
      .then(setQueue)
      .catch((e: unknown) => setError(`Couldn't load the review queue: ${String(e)}`))
      .finally(() => setIsLoading(false))
  }, [workspacePath, cramStreak, cramStruggling, tagsKey, allWorkspaces])

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
    void fetchQueue(workspacePath).then((fetched) => {
      setQueue(fetched)
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
      .gradeCard(notePath, current.position, g, current.workspace)
      .then(() => useWorkspaceStore.getState().addGitPendingPath(notePath))
      .catch(() => {})
      .finally(refetch)
  }

  function suspend() {
    if (!workspacePath || !current) return
    const notePath = current.notePath
    void api.notes
      .setCardSuspended(notePath, current.position, true, current.workspace)
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
      .gradeMcCard(notePath, current.position, Array.from(picked), current.workspace)
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
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="review-session" showCloseButton={false} aria-describedby={undefined}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>
              {cramStreak !== null
                ? `Cram — ${cramStruggling ? 'Struggling' : cramStreak === 0 ? 'New' : `Category ${cramStreak}`}${queue.length > 0 ? ` (${queue.length} left)` : ''}`
                : tagsKey !== null
                  ? `Review — ${tagsKey.split(',').join(', ')}${queue.length > 0 ? ` (${queue.length} left)` : ''}`
                  : `Review${queue.length > 0 ? ` (${queue.length} due)` : ''}`}
            </h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close review" title="Close review">
            <X size={16} />
          </button>
        </div>
        {cramStreak !== null && categories.length > 1 && onSwitchCategory && (
          <div className="review-cram-categories">
            {categories.map(({ streak, count, struggling }) => (
              <button
                key={struggling ? 'struggling' : streak}
                className={`review-cram-category${streak === cramStreak && struggling === cramStruggling ? ' review-cram-category-active' : ''}`}
                onClick={() => onSwitchCategory(streak, struggling)}
              >
                {struggling ? 'Struggling' : streak === 0 ? 'New' : `Category ${streak}`} ({count})
              </button>
            ))}
          </div>
        )}
        {cramStreak === null && tagsKey === null && (
          <label className="search-scope-toggle">
            <input
              type="checkbox"
              checked={allWorkspaces}
              onChange={(e) => setAllWorkspaces(e.target.checked)}
            />
            Review all workspaces
          </label>
        )}
        {isLoading ? (
          <LoadingStatus />
        ) : error ? (
          <p className="empty-state">{error}</p>
        ) : !current ? (
          <p className="empty-state">
            {cramStreak !== null
              ? 'No cards in this category.'
              : tagsKey !== null
                ? 'No cards with these tags.'
                : 'All done for today.'}
          </p>
        ) : (
          <div className="review-card">
            <div className="review-card-header">
              <p className="review-card-note">
                {current.noteTitle}
                {current.workspace !== workspacePath && (
                  <span className="search-result-workspace">{current.workspace.split(/[/\\]/).pop()}</span>
                )}
              </p>
              <button
                className="review-card-suspend"
                onClick={suspend}
                aria-label="Suspend card"
                title="Suspend card from review queue"
              >
                Suspend
              </button>
            </div>
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
      </DialogContent>
    </Dialog>
  )
}
