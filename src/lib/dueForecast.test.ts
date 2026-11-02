import { describe, it, expect } from 'vitest'
import { dueForecast } from './dueForecast'

const card = (due: string, suspended = false) => ({ due, suspended })

describe('dueForecast', () => {
  it('buckets cards by day, folds overdue into today, drops suspended and out-of-window', () => {
    const result = dueForecast(
      [
        card('2026-01-01'),
        card('2026-03-01'),
        card('2026-03-03'),
        card('2026-03-03'),
        card('2026-03-02', true),
        card('2026-03-31'),
      ],
      '2026-03-01',
      3,
    )
    expect(result).toEqual([
      { date: '2026-03-01', count: 2 },
      { date: '2026-03-02', count: 0 },
      { date: '2026-03-03', count: 2 },
    ])
  })
})
