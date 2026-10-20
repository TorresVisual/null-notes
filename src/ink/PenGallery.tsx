import { useInkStore } from '../store/ink'
import { PenFlyout } from './PenFlyout'
import { PenSample } from './PenSample'
import { ToolFlyout } from './ToolFlyout'

export function PenGallery() {
  const pens = useInkStore((s) => s.pens)
  const activePenId = useInkStore((s) => s.activePenId)
  const tool = useInkStore((s) => s.tool)
  const selectPen = useInkStore((s) => s.selectPen)

  return (
    <div className="ink-pen-gallery" role="group" aria-label="Pens">
      {pens.map((pen) => (
        <ToolFlyout
          key={pen.id}
          className="ink-pen-card"
          active={tool === 'pen' && pen.id === activePenId}
          onActivate={() => selectPen(pen.id)}
          label={pen.label}
          icon={<PenSample color={pen.color} size={pen.size} opacity={pen.opacity} />}
        >
          <PenFlyout />
        </ToolFlyout>
      ))}
    </div>
  )
}
