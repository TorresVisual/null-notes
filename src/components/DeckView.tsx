import { useEffect, useMemo, useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { LoadingStatus } from './LoadingStatus'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { promptText } from '../store/promptDialog'
import { groupCardsByNote, groupCardsByStreak } from '../lib/cardGroups'
import { CardText } from './CardText'
import type { CardSummary } from '../types'

interface DeckViewProps {
  onClose: () => void
  onOpenCram: (streak: number, struggling: boolean) => void
}

// The conventional SRS "graduated" threshold — a display bucket only, not a
// new scheduling concept.
const MASTERED_INTERVAL_DAYS = 21

function isDueToday(due: string): boolean {
  return due <= new Date().toISOString().slice(0, 10)
}

export function DeckView({ onClose, onOpenCram }: DeckViewProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [cards, setCards] = useState<CardSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const [suspendedFilter, setSuspendedFilter] = useState<'all' | 'suspended'>('all')

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    setError(null)
    api.notes
      .listAllCards(workspacePath)
      .then((c) => setCards(c))
      .catch((e: unknown) => setError(`Couldn't load cards: ${String(e)}`))
      .finally(() => setIsLoading(false))
  }, [workspacePath])

  const allTags = useMemo(
    () => Array.from(new Set(cards.flatMap((c) => c.tags))).sort(),
    [cards],
  )

  const filtered = useMemo(
    () =>
      cards.filter((c) => {
        if (suspendedFilter === 'suspended' && !c.suspended) return false
        if (activeTags.size > 0 && !c.tags.some((t) => activeTags.has(t))) return false
        return true
      }),
    [cards, suspendedFilter, activeTags],
  )

  const groups = useMemo(() => groupCardsByNote(filtered), [filtered])

  const activeCardsForCategories = useMemo(
    () =>
      cards.filter(
        (c) => !c.suspended && (activeTags.size === 0 || c.tags.some((t) => activeTags.has(t))),
      ),
    [cards, activeTags],
  )
  const categories = useMemo(
    () => groupCardsByStreak(activeCardsForCategories),
    [activeCardsForCategories],
  )

  const dueCount = useMemo(
    () => cards.filter((c) => !c.suspended && isDueToday(c.due)).length,
    [cards],
  )
  const masteredCount = useMemo(
    () => cards.filter((c) => !c.suspended && c.interval >= MASTERED_INTERVAL_DAYS).length,
    [cards],
  )
  const suspendedCount = useMemo(() => cards.filter((c) => c.suspended).length, [cards])

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  async function handleRenameTag(e: React.MouseEvent, tag: string) {
    e.preventDefault()
    e.stopPropagation()
    if (!workspacePath) return
    const newTag = await promptText('Rename tag:', tag)
    if (!newTag || newTag === tag) return
    try {
      await api.notes.renameTag(tag, newTag, workspacePath)
      setActiveTags((prev) => {
        if (!prev.has(tag)) return prev
        const next = new Set(prev)
        next.delete(tag)
        next.add(newTag)
        return next
      })
      const refreshed = await api.notes.listAllCards(workspacePath)
      setCards(refreshed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function toggleSuspend(e: React.MouseEvent, c: CardSummary) {
    e.preventDefault()
    e.stopPropagation()
    if (!workspacePath) return
    try {
      await api.notes.setCardSuspended(c.notePath, c.position, !c.suspended, workspacePath)
      useWorkspaceStore.getState().addGitPendingPath(c.notePath)
      const refreshed = await api.notes.listAllCards(workspacePath)
      setCards(refreshed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function openNote(path: string) {
    openTab(path)
    onClose()
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="task-view deck-view" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>All Cards</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close deck view" title="Close deck view">
            <X size={16} />
          </button>
        </div>
        {isLoading ? (
          <LoadingStatus />
        ) : error ? (
          <p className="empty-state">{error}</p>
        ) : cards.length === 0 ? (
          <p className="empty-state">No flashcards in this workspace yet.</p>
        ) : (
          <>
            <div className="deck-view-stats">
              <span>{cards.length}</span>
              <span>{dueCount} due</span>
              <span>{masteredCount} mastered</span>
              {suspendedCount > 0 && (
                <button
                  className={`deck-view-suspended-filter${suspendedFilter === 'suspended' ? ' deck-view-suspended-filter-active' : ''}`}
                  onClick={() => setSuspendedFilter((prev) => (prev === 'suspended' ? 'all' : 'suspended'))}
                >
                  {suspendedCount} suspended
                </button>
              )}
            </div>
            {allTags.length > 0 && (
              <div className="deck-view-tags">
                {allTags.map((tag) => (
                  <label key={tag} className="deck-view-tag">
                    <input
                      type="checkbox"
                      checked={activeTags.has(tag)}
                      onChange={() => toggleTag(tag)}
                      aria-label={tag}
                    />
                    {tag}
                    <button
                      className="deck-view-tag-rename"
                      onClick={(e) => handleRenameTag(e, tag)}
                      aria-label={`Rename tag ${tag}`}
                      title={`Rename tag ${tag}`}
                    >
                      <Pencil size={11} />
                    </button>
                  </label>
                ))}
              </div>
            )}
            {categories.length > 0 && (
              <div className="deck-view-categories">
                {categories.map(({ streak, count, struggling }) => (
                  <div key={struggling ? 'struggling' : streak} className="deck-view-category">
                    <span>
                      {struggling ? 'Struggling' : streak === 0 ? 'New' : `Category ${streak}`} ({count})
                    </span>
                    <button
                      className="deck-view-category-cram"
                      onClick={() => onOpenCram(streak, struggling)}
                    >
                      Cram
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="task-view-list">
              {groups.map((group) => (
                <div key={group.notePath} className="task-view-group">
                  <button className="task-view-note-title" onClick={() => openNote(group.notePath)}>
                    {group.noteTitle}
                  </button>
                  <ul>
                    {group.cards.map((c) => (
                      <li key={c.position} className="task-view-item deck-view-item">
                        <button className="task-view-item-text" onClick={() => openNote(group.notePath)}>
                          <CardText text={c.front} notePath={group.notePath} />
                        </button>
                        {c.suspended && <span className="deck-view-suspended-badge">Suspended</span>}
                        <button
                          className="deck-view-suspend-btn"
                          onClick={(e) => toggleSuspend(e, c)}
                          aria-label={c.suspended ? `Unsuspend card ${c.front}` : `Suspend card ${c.front}`}
                          title={c.suspended ? 'Unsuspend card' : 'Suspend card'}
                        >
                          {c.suspended ? 'Unsuspend' : 'Suspend'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
