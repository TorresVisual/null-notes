import {
  PenLine,
  Eraser,
  Lasso,
  Minus,
  Circle,
  Square,
  MoveUpRight,
  Ruler as RulerIcon,
  Trash2,
  Undo2,
  Redo2,
} from 'lucide-react'
import { useInkStore, activePenOf } from '../../store/ink'
import type { EraserMode, Tool } from '../../ink/types'

const TOOLS: { id: Tool; label: string; Icon: typeof PenLine }[] = [
  { id: 'pen', label: 'Pen', Icon: PenLine },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
  { id: 'lasso', label: 'Lasso select', Icon: Lasso },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'arrow', label: 'Arrow', Icon: MoveUpRight },
]

// A swatch that scaled 1:1 with pen size would make a 20px highlighter swallow
// its button and a 2px nib vanish, so the range is compressed, not mapped.
function swatchDiameter(size: number): number {
  return Math.round(5 + size * 0.5)
}

const ERASER_MODES: { id: EraserMode; label: string; hint: string }[] = [
  { id: 'point', label: 'Point', hint: 'Point eraser — rubs out only what it passes over' },
  { id: 'stroke', label: 'Stroke', hint: 'Stroke eraser — removes a whole stroke on contact' },
]

const ZOOM_LEVELS = [0.75, 1, 1.5, 2]

// The one group that takes the bar alone: everything here acts on whichever
// canvas last registered itself as active, via the store's `activeCanvas`
// handle rather than a prop — the bar has no idea which block that is.
export function InkToolGroup() {
  const active = useInkStore((s) => s.activeCanvas)
  const tool = useInkStore((s) => s.tool)
  const pens = useInkStore((s) => s.pens)
  const activePenId = useInkStore((s) => s.activePenId)
  const eraserMode = useInkStore((s) => s.eraserMode)
  const eraserSize = useInkStore((s) => s.eraserSize)
  const setTool = useInkStore((s) => s.setTool)
  const selectPen = useInkStore((s) => s.selectPen)
  const updateActivePen = useInkStore((s) => s.updateActivePen)
  const setEraserMode = useInkStore((s) => s.setEraserMode)
  const setEraserSize = useInkStore((s) => s.setEraserSize)
  const { color, size } = activePenOf({ pens, activePenId })

  if (!active) return null

  const { undo, redo, canUndo, canRedo, deleteSelected, hasSelection, toggleRuler, rulerOn, zoom, setZoom } = active

  return (
    <div className="toolbar-group toolbar-ink" role="group" aria-label="Drawing tools">
      {TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`ink-tool${tool === id ? ' active' : ''}`}
          onClick={() => setTool(id)}
          aria-pressed={tool === id}
          aria-label={label}
          title={label}
        >
          <Icon size={15} />
        </button>
      ))}
      <button
        className={`ink-tool${rulerOn ? ' active' : ''}`}
        onClick={toggleRuler}
        aria-pressed={rulerOn}
        aria-label="Ruler"
        title="Ruler — draw along its edge; drag the middle to slide it, an end to swing it"
      >
        <RulerIcon size={15} />
      </button>
      {hasSelection && (
        <button
          className="ink-tool ink-delete"
          onClick={deleteSelected}
          aria-label="Delete selection"
          title="Delete selection (Del)"
        >
          <Trash2 size={15} />
        </button>
      )}
      <span className="ink-sep" aria-hidden />
      {pens.map((pen) => (
        <button
          key={pen.id}
          className={`ink-pen${pen.id === activePenId ? ' active' : ''}`}
          onClick={() => selectPen(pen.id)}
          aria-pressed={pen.id === activePenId}
          aria-label={pen.label}
          title={pen.label}
        >
          <span
            className="ink-pen-swatch"
            style={{
              background: pen.color,
              opacity: pen.opacity,
              width: swatchDiameter(pen.size),
              height: swatchDiameter(pen.size),
            }}
          />
        </button>
      ))}
      <span className="ink-sep" aria-hidden />
      <input
        type="color"
        value={color}
        onChange={(e) => updateActivePen({ color: e.target.value })}
        aria-label="Pen color"
      />
      {/* One slider, sized for whichever tool is in hand — you write fine and
          rub out broadly, so the two sizes are remembered separately. */}
      {tool === 'eraser' ? (
        <>
          {ERASER_MODES.map(({ id, label, hint }) => (
            <button
              key={id}
              className={`ink-tool ink-mode${eraserMode === id ? ' active' : ''}`}
              onClick={() => setEraserMode(id)}
              aria-pressed={eraserMode === id}
              aria-label={hint}
              title={hint}
            >
              {label}
            </button>
          ))}
          <input
            type="range"
            min={4}
            max={80}
            value={eraserSize}
            onChange={(e) => setEraserSize(Number(e.target.value))}
            aria-label="Eraser size"
          />
        </>
      ) : (
        <input
          type="range"
          min={1}
          max={24}
          value={size}
          onChange={(e) => updateActivePen({ size: Number(e.target.value) })}
          aria-label="Pen size"
        />
      )}
      <span className="ink-sep" aria-hidden />
      <button className="ink-tool" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo">
        <Undo2 size={15} />
      </button>
      <button className="ink-tool" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo">
        <Redo2 size={15} />
      </button>
      <span className="ink-sep" aria-hidden />
      {ZOOM_LEVELS.map((level) => (
        <button
          key={level}
          className={`ink-tool ink-zoom${zoom === level ? ' active' : ''}`}
          onClick={() => setZoom(level)}
          aria-pressed={zoom === level}
          aria-label={`Zoom ${level}x`}
          title={`Zoom ${level}x`}
        >
          {level}×
        </button>
      ))}
    </div>
  )
}
