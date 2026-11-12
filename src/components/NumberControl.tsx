import { isMobile } from '../lib/platform'

interface NumberControlProps {
  value: number
  min: number
  max: number
  step: number
  label: string
  onChange: (value: number) => void
}

function stepDecimals(step: number): number {
  return step < 1 ? String(step).split('.')[1]?.length ?? 0 : 0
}

export function NumberControl({ value, min, max, step, label, onChange }: NumberControlProps) {
  if (!isMobile()) {
    return (
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    )
  }

  const decimals = stepDecimals(step)
  const nudge = (direction: 1 | -1) => onChange(Number((value + direction * step).toFixed(decimals)))

  return (
    <div className="settings-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => nudge(-1)}>
        −
      </button>
      <output>{value}</output>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => nudge(1)}>
        +
      </button>
    </div>
  )
}
