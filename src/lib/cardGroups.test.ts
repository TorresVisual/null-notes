import { describe, it, expect } from 'vitest'
import { groupCardsByNote } from './cardGroups'
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
