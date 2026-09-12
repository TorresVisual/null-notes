import { describe, it, expect } from 'vitest'
import { groupCardsByNote, groupCardsByStreak } from './cardGroups'
import type { CardSummary } from '../types'

const card = (over: Partial<CardSummary>): CardSummary => ({
  notePath: '/ws/a.md',
  noteTitle: 'A',
  kind: 'qa',
  front: 'Q',
  back: 'A',
  position: 0,
  due: '2026-01-01',
  interval: 0,
  streak: 0,
  lapses: 0,
  suspended: false,
  tags: [],
  ...over,
})

describe('groupCardsByNote', () => {
  it('groups cards under their note, preserving arrival order', () => {
    const cards = [
      card({ notePath: '/ws/a.md', position: 0 }),
      card({ notePath: '/ws/b.md', noteTitle: 'B', position: 0 }),
      card({ notePath: '/ws/a.md', position: 1 }),
    ]
    const groups = groupCardsByNote(cards)
    expect(groups.map((g) => g.notePath)).toEqual(['/ws/a.md', '/ws/b.md'])
    expect(groups[0]!.cards).toHaveLength(2)
    expect(groups[1]!.cards).toHaveLength(1)
  })
})

describe('groupCardsByStreak', () => {
  it('buckets cards by streak, sorted ascending, with counts', () => {
    const cards = [
      card({ streak: 2 }),
      card({ streak: 0 }),
      card({ streak: 2 }),
      card({ streak: 1 }),
    ]
    expect(groupCardsByStreak(cards)).toEqual([
      { streak: 0, count: 1, struggling: false },
      { streak: 1, count: 1, struggling: false },
      { streak: 2, count: 2, struggling: false },
    ])
  })

  it('splits streak-0 cards with prior lapses into their own struggling bucket', () => {
    const cards = [
      card({ streak: 0, lapses: 0 }), // brand new
      card({ streak: 0, lapses: 3 }), // repeatedly failed
      card({ streak: 1, lapses: 2 }), // lapsed before but currently on a streak
    ]
    expect(groupCardsByStreak(cards)).toEqual([
      { streak: 0, count: 1, struggling: false },
      { streak: 0, count: 1, struggling: true },
      { streak: 1, count: 1, struggling: false },
    ])
  })
})
