import type { CardSummary } from '../types'

export type CardTone = 'due' | 'new' | 'suspended' | 'later'

export interface CardStatus {
  tone: CardTone
  label: string
}

const DAY_MS = 86_400_000

export function cardStatus(card: CardSummary, today: string): CardStatus {
  if (card.suspended) return { tone: 'suspended', label: 'Suspended' }
  if (card.streak === 0 && card.lapses === 0) return { tone: 'new', label: 'New' }
  const days = Math.round((Date.parse(card.due) - Date.parse(today)) / DAY_MS)
  const when = days <= 0 ? 'Due today' : days === 1 ? 'Tomorrow' : `In ${days} days`
  const category = card.streak === 0 ? 'Struggling' : `Category ${card.streak}`
  return { tone: days <= 0 ? 'due' : 'later', label: `${when} · ${category}` }
}
