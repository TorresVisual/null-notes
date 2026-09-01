import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { groupCardsByNote } from '../lib/cardGroups'
import type { CardSummary } from '../types'

interface DeckViewProps {
  onClose: () => void
}

// The conventional SRS "graduated" threshold — a display bucket only, not a
// new scheduling concept.
const MASTERED_INTERVAL_DAYS = 21

function isDueToday(due: string): boolean {
  return due <= new Date().toISOString().slice(0, 10)
}

export function DeckView({ onClose }: DeckViewProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [cards, setCards] = useState<CardSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    api.notes.listAllCards(workspacePath).then((c) => {
      setCards(c)
      setIsLoading(false)
    })
  }, [workspacePath])

  const allTags = useMemo(
    () => Array.from(new Set(cards.flatMap((c) => c.tags))).sort(),
    [cards],
  )

  const filtered = useMemo(
    () =>
      activeTags.size === 0
        ? cards
        : cards.filter((c) => c.tags.some((t) => activeTags.has(t))),
    [cards, activeTags],
  )

  const groups = useMemo(() => groupCardsByNote(filtered), [filtered])
  const dueCount = useMemo(() => cards.filter((c) => isDueToday(c.due)).length, [cards])
  const masteredCount = useMemo(
    () => cards.filter((c) => c.interval >= MASTERED_INTERVAL_DAYS).length,
    [cards],
  )

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
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
          <p className="status">Loading…</p>
        ) : cards.length === 0 ? (
          <p className="empty-state">No flashcards in this workspace yet.</p>
        ) : (
          <>
            <div className="deck-view-stats">
              <span>{cards.length}</span>
              <span>{dueCount} due</span>
              <span>{masteredCount} mastered</span>
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
                  </label>
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
                      <li key={c.position} className="task-view-item">
                        <span className="task-view-item-text">{c.front}</span>
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
