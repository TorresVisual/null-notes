import { useState } from 'react'
import { Layers, MoreHorizontal } from 'lucide-react'
import { CardText } from './CardText'
import { DeckCardSheet } from './DeckCardSheet'
import { DueForecast } from './DueForecast'
import { cardStatus } from '../lib/cardStatus'
import type { CardGroup, CardStreakGroup } from '../lib/cardGroups'
import type { CardSummary } from '../types'

export type CardFilter = 'all' | 'due' | 'suspended'

interface DeckMobileBodyProps {
  cardCount: number
  groups: CardGroup[]
  filteredCount: number
  categories: CardStreakGroup[]
  forecastCards: CardSummary[]
  allTags: string[]
  activeTags: Set<string>
  filter: CardFilter
  dueCount: number
  masteredCount: number
  suspendedCount: number
  onToggleTag: (tag: string) => void
  onFilter: (filter: CardFilter) => void
  onClearFilters: () => void
  onCram: (streak: number, struggling: boolean) => void
  onTagReview: (tags: string[]) => void
  onOpenCard: (notePath: string, card: CardSummary) => void
  onToggleSuspend: (card: CardSummary) => void
  onClose: () => void
}

type View = 'study' | 'cards'

const FILTER_LABELS: Record<CardFilter, string> = { all: 'All', due: 'Due', suspended: 'Suspended' }

function categoryLabel({ streak, struggling }: CardStreakGroup): string {
  return struggling ? 'Struggling' : streak === 0 ? 'New' : `Category ${streak}`
}

function noMatchText(filter: CardFilter, tags: string[]): string {
  const kind = filter === 'all' ? '' : `${filter} `
  return `No ${kind}cards${tags.length > 0 ? ` tagged ${tags.join(', ')}` : ''}.`
}

export function DeckMobileBody(props: DeckMobileBodyProps) {
  const { groups, activeTags, filter, categories } = props
  const [view, setView] = useState<View>('study')
  const [sheetCard, setSheetCard] = useState<CardSummary | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const tags = Array.from(activeTags)

  if (props.cardCount === 0) {
    return (
      <div className="deck-mobile-empty">
        <Layers size={36} className="deck-mobile-empty-icon" />
        <h3>No flashcards yet</h3>
        <p>
          Any line in any note can be a card. Put <b>::</b> between the front and the back.
        </p>
        <pre className="deck-mobile-empty-code">
          {'Capital of France :: Paris\nWater boils at {{100}} °C'}
        </pre>
        <p className="deck-mobile-empty-hint">The second line is a cloze card: the braces hide the answer.</p>
        <button className="deck-mobile-ghost" onClick={props.onClose}>
          Close
        </button>
      </div>
    )
  }

  return (
    <div className="deck-mobile">
      <div className="deck-mobile-top">
        {props.allTags.length > 0 && (
          <div className="deck-mobile-chips">
            {props.allTags.map((tag) => (
              <button
                key={tag}
                className={`deck-mobile-chip${activeTags.has(tag) ? ' deck-mobile-chip-active' : ''}`}
                aria-pressed={activeTags.has(tag)}
                onClick={() => props.onToggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        <div className="deck-mobile-seg" role="tablist">
          <button role="tab" aria-selected={view === 'study'} onClick={() => setView('study')}>
            Study
          </button>
          <button role="tab" aria-selected={view === 'cards'} onClick={() => setView('cards')}>
            Cards ({props.filteredCount})
          </button>
        </div>
      </div>

      <div className="deck-mobile-scroll">
        {view === 'study' ? (
          <>
            <div className="deck-mobile-stats">
              <div className="deck-mobile-stat deck-mobile-stat-due">
                <b>{props.dueCount}</b>
                <span>due</span>
              </div>
              <div className="deck-mobile-stat">
                <b>{props.cardCount}</b>
                <span>total</span>
              </div>
              <div className="deck-mobile-stat">
                <b>{props.masteredCount}</b>
                <span>mastered</span>
              </div>
            </div>
            <DueForecast cards={props.forecastCards} />
            {categories.length > 0 && <h3 className="deck-mobile-label">Cram by category</h3>}
            {categories.map((category) => (
              <div key={category.struggling ? 'struggling' : category.streak} className="deck-mobile-category">
                <span className="deck-mobile-category-name">{categoryLabel(category)}</span>
                <span className="deck-mobile-category-count">{category.count}</span>
                <button
                  className="deck-mobile-cram"
                  aria-label={`Cram ${categoryLabel(category)}`}
                  onClick={() => props.onCram(category.streak, category.struggling)}
                >
                  Cram
                </button>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="deck-mobile-chips">
              {(Object.keys(FILTER_LABELS) as CardFilter[]).map((f) => (
                <button
                  key={f}
                  className={`deck-mobile-chip${filter === f ? ' deck-mobile-chip-active' : ''}`}
                  aria-pressed={filter === f}
                  onClick={() => props.onFilter(f)}
                >
                  {FILTER_LABELS[f]}
                  {f === 'due' && ` (${props.dueCount})`}
                  {f === 'suspended' && ` (${props.suspendedCount})`}
                </button>
              ))}
            </div>
            {groups.length === 0 && (
              <div className="deck-mobile-nomatch">
                <p>{noMatchText(filter, tags)}</p>
                <button className="deck-mobile-ghost" onClick={props.onClearFilters}>
                  Clear filters
                </button>
              </div>
            )}
            {groups.map((group) => (
              <section key={group.notePath} className="deck-mobile-group">
                <header>
                  <h3>{group.noteTitle}</h3>
                  <span>{group.cards.length}</span>
                </header>
                <ul className="deck-mobile-list">
                  {group.cards.map((card) => {
                    const status = cardStatus(card, today)
                    return (
                      <li key={card.position} className={`deck-mobile-row deck-mobile-row-${status.tone}`}>
                        <button
                          className="deck-mobile-row-main"
                          onClick={() => props.onOpenCard(group.notePath, card)}
                        >
                          <span className={`deck-mobile-row-front${card.suspended ? ' deck-mobile-row-dim' : ''}`}>
                            <CardText text={card.front} notePath={group.notePath} />
                          </span>
                          <span className="deck-mobile-row-status">{status.label}</span>
                        </button>
                        <button
                          className="deck-mobile-row-more"
                          aria-label={`Options for card ${card.front}`}
                          onClick={() => setSheetCard(card)}
                        >
                          <MoreHorizontal size={20} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>

      {tags.length > 0 && (
        <div className="deck-mobile-dock">
          <button className="deck-mobile-primary" onClick={() => props.onTagReview(tags)}>
            {tags.length === 1 ? `Review tag: ${tags[0]}` : `Review ${tags.length} tags`}
          </button>
        </div>
      )}

      {sheetCard && (
        <DeckCardSheet
          card={sheetCard}
          onClose={() => setSheetCard(null)}
          onOpenNote={() => {
            setSheetCard(null)
            props.onOpenCard(sheetCard.notePath, sheetCard)
          }}
          onToggleSuspend={() => {
            setSheetCard(null)
            props.onToggleSuspend(sheetCard)
          }}
        />
      )}
    </div>
  )
}
