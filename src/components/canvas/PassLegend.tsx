import type { CSSProperties } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { passColorIndex } from '../../lib/jsonCanvas'

interface PassLegendProps {
  passes: number[]
  hidden: ReadonlySet<number>
  onToggle: (pass: number) => void
  onShowOnlyLatest: () => void
  onJump: (pass: number) => void
}

export function PassLegend({ passes, hidden, onToggle, onShowOnlyLatest, onJump }: PassLegendProps) {
  if (passes.length === 0) return null
  return (
    <div className="canvas-legend" role="group" aria-label="Passes">
      {passes.map((pass) => {
        const isHidden = hidden.has(pass)
        return (
          <div key={pass} className={`canvas-legend-row${isHidden ? ' is-hidden' : ''}`}>
            <span
              className="canvas-legend-swatch"
              style={{ '--card-accent': `var(--pass-${passColorIndex(pass)})` } as CSSProperties}
            />
            <button className="canvas-legend-label" onClick={() => onJump(pass)}>
              Pass {pass}
            </button>
            <button
              className="canvas-legend-eye"
              onClick={() => onToggle(pass)}
              aria-label={`${isHidden ? 'Show' : 'Hide'} pass ${pass}`}
              title={`${isHidden ? 'Show' : 'Hide'} pass ${pass}`}
            >
              {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        )
      })}
      {passes.length > 1 && (
        <button className="canvas-legend-only" onClick={onShowOnlyLatest}>
          Show only latest
        </button>
      )}
    </div>
  )
}
