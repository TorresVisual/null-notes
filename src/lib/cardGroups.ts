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
  // A card at streak 0 that has lapsed before (graded Again on a card it had
  // already reviewed, see sm2::next_lapses) is a repeat failure, not a fresh
  // card — its own bucket keeps it out of "New" (issue #42).
  struggling: boolean
}

export function groupCardsByStreak(cards: CardSummary[]): CardStreakGroup[] {
  const groups = new Map<string, CardStreakGroup>()
  for (const card of cards) {
    const struggling = card.streak === 0 && card.lapses > 0
    const key = struggling ? 'struggling' : String(card.streak)
    const existing = groups.get(key)
    if (existing) {
      existing.count++
    } else {
      groups.set(key, { streak: card.streak, count: 1, struggling })
    }
  }
  return Array.from(groups.values()).sort(
    (a, b) => a.streak - b.streak || Number(a.struggling) - Number(b.struggling),
  )
}
