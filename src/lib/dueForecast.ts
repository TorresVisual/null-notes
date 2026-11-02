import type { CardSummary } from '../types'

export interface ForecastDay {
  date: string
  count: number
}

const DAY_MS = 86_400_000

// Overdue cards count toward day 0 (they're reviewable today); cards due
// past the window are left out. Dates are UTC `YYYY-MM-DD`, matching how
// `due` is stored and how DeckView decides what is due today.
export function dueForecast(
  cards: Pick<CardSummary, 'due' | 'suspended'>[],
  today: string,
  days: number,
): ForecastDay[] {
  const start = Date.parse(today)
  const forecast = Array.from({ length: days }, (_, i) => ({
    date: new Date(start + i * DAY_MS).toISOString().slice(0, 10),
    count: 0,
  }))
  for (const card of cards) {
    if (card.suspended) continue
    const offset = Math.max(0, Math.round((Date.parse(card.due) - start) / DAY_MS))
    const day = forecast[offset]
    if (day) day.count++
  }
  return forecast
}
