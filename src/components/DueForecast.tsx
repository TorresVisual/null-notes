import { useMemo } from 'react'
import { dueForecast } from '../lib/dueForecast'
import type { CardSummary } from '../types'

interface DueForecastProps {
  cards: CardSummary[]
}

const FORECAST_DAYS = 14
const BAR_MAX_PX = 48

export function DueForecast({ cards }: DueForecastProps) {
  const forecast = useMemo(
    () => dueForecast(cards, new Date().toISOString().slice(0, 10), FORECAST_DAYS),
    [cards],
  )
  const max = Math.max(1, ...forecast.map((d) => d.count))

  return (
    <div className="deck-view-forecast" role="img" aria-label="Cards due over the next 14 days">
      {forecast.map(({ date, count }, i) => (
        <div key={date} className="deck-view-forecast-day" title={`${date}: ${count} due`}>
          <span className="deck-view-forecast-count">{count > 0 ? count : ''}</span>
          <div className="deck-view-forecast-bar" style={{ height: `${Math.round((count / max) * BAR_MAX_PX)}px` }} />
          <span className="deck-view-forecast-label">
            {i === 0 ? 'Today' : date.slice(8)}
          </span>
        </div>
      ))}
    </div>
  )
}
