import { describe, it, expect } from 'vitest'
import { cardStatus } from './cardStatus'
import type { CardSummary } from '../types'

const base: CardSummary = {
  notePath: '/ws/a.md',
  noteTitle: 'A',
  kind: 'qa',
  front: 'Q',
  back: 'A',
  position: 0,
  due: '2026-11-12',
  interval: 3,
  streak: 2,
  lapses: 0,
  suspended: false,
  tags: [],
}

describe('cardStatus', () => {
  it('flags a card due today or overdue', () => {
    expect(cardStatus(base, '2026-11-12')).toEqual({ tone: 'due', label: 'Due today · Category 2' })
    expect(cardStatus({ ...base, due: '2026-11-01' }, '2026-11-12').tone).toBe('due')
  })

  it('counts days until a later card is due', () => {
    expect(cardStatus({ ...base, due: '2026-11-13' }, '2026-11-12').label).toBe('Tomorrow · Category 2')
    expect(cardStatus({ ...base, due: '2026-11-16' }, '2026-11-12')).toEqual({ tone: 'later', label: 'In 4 days · Category 2' })
  })

  it('separates new, struggling and suspended cards', () => {
    expect(cardStatus({ ...base, streak: 0 }, '2026-11-12')).toEqual({ tone: 'new', label: 'New' })
    expect(cardStatus({ ...base, streak: 0, lapses: 2 }, '2026-11-12').label).toBe('Due today · Struggling')
    expect(cardStatus({ ...base, suspended: true }, '2026-11-12')).toEqual({ tone: 'suspended', label: 'Suspended' })
  })
})
