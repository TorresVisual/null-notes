import { useInkStore, activePenOf } from '../store/ink'
import { PenSample } from './PenSample'

const PEN_COLORS = [
  '#e6edf3', '#9da7b3', '#ff7b72', '#ffa657', '#e3b341', '#7ee787',
  '#56d4dd', '#79c0ff', '#a5a5ff', '#d2a8ff', '#ff9bce', '#c9a27e',
]

export function PenFlyout() {
  const pens = useInkStore((s) => s.pens)
  const activePenId = useInkStore((s) => s.activePenId)
  const updateActivePen = useInkStore((s) => s.updateActivePen)
  const pen = activePenOf({ pens, activePenId })

  return (
    <div className="ink-flyout-body">
      <PenSample color={pen.color} size={pen.size} opacity={pen.opacity} large />
      <label className="ink-flyout-row">
        <span>Thickness</span>
        <input
          type="range"
          min={1}
          max={24}
          step={0.5}
          value={pen.size}
          onChange={(e) => updateActivePen({ size: Number(e.target.value) })}
          aria-label="Pen thickness"
        />
      </label>
      <div className="ink-color-grid" role="group" aria-label="Pen color">
        {PEN_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`ink-color-swatch${color === pen.color ? ' active' : ''}`}
            style={{ background: color }}
            onClick={() => updateActivePen({ color })}
            aria-pressed={color === pen.color}
            aria-label={color}
          />
        ))}
        <input
          type="color"
          value={pen.color}
          onChange={(e) => updateActivePen({ color: e.target.value })}
          aria-label="Custom color"
        />
      </div>
    </div>
  )
}
