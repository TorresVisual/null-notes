import type { CardSummary } from '../types'

export interface CardGroup {
  notePath: string
  noteTitle: string
  cards: CardSummary[]
}

// list_all_cards orders by note title then position (matching due_cards'
// own ordering), so grouping here only has to preserve arrival order rather
// than re-sort — same shape as lib/taskGroups.ts's groupByNote, kept as its
// own function since CardSummary isn't OpenTask.
export function groupCardsByNote(cards: CardSummary[]): CardGroup[] {
  const groups: CardGroup[] = []
  const byPath = new Map<string, CardGroup>()
  for (const card of cards) {
    let group = byPath.get(card.notePath)
    if (!group) {
      group = { notePath: card.notePath, noteTitle: card.noteTitle, cards: [] }
      byPath.set(card.notePath, group)
      groups.push(group)
    }
    group.cards.push(card)
  }
  return groups
}

export interface CardStreakGroup {
  streak: number
  count: number
}

export function groupCardsByStreak(cards: CardSummary[]): CardStreakGroup[] {
  const counts = new Map<number, number>()
  for (const card of cards) {
    counts.set(card.streak, (counts.get(card.streak) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a - b)
    .map(([streak, count]) => ({ streak, count }))
}
