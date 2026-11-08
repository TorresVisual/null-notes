import { useState } from 'react'
import {
  Eraser,
  Lasso,
  Type,
  Crop,
  Ruler as RulerIcon,
  Trash2,
  Undo2,
  Redo2,
  Minus,
  Circle,
  Square,
  MoveUpRight,
} from 'lucide-react'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useInkStore } from '../store/ink'
import type { EraserMode, Tool } from './types'
import { PenGallery } from './PenGallery'
import { ToolFlyout } from './ToolFlyout'

type ShapeTool = Extract<Tool, 'line' | 'circle' | 'rect' | 'arrow'>

const SHAPES: Record<ShapeTool, { label: string; Icon: typeof Minus }> = {
  line: { label: 'Line', Icon: Minus },
  circle: { label: 'Circle', Icon: Circle },
  rect: { label: 'Rectangle', Icon: Square },
  arrow: { label: 'Arrow', Icon: MoveUpRight },
}
const SHAPE_IDS: ShapeTool[] = ['line', 'circle', 'rect', 'arrow']

function isShapeTool(tool: Tool): tool is ShapeTool {
  return tool in SHAPES
}

const ERASER_MODES: { id: EraserMode; label: string; hint: string }[] = [
  { id: 'point', label: 'Point', hint: 'Point eraser — rubs out only what it passes over' },
  { id: 'stroke', label: 'Stroke', hint: 'Stroke eraser — removes a whole stroke on contact' },
]

const ZOOM_LEVELS = [0.75, 1, 1.5, 2]
const ICON_SIZE = 16

interface DrawRibbonProps {
  onDone: () => void
}

export function DrawRibbon({ onDone }: DrawRibbonProps) {
  const active = useInkStore((s) => s.activeCanvas)
  const tool = useInkStore((s) => s.tool)
  const eraserMode = useInkStore((s) => s.eraserMode)
  const eraserSize = useInkStore((s) => s.eraserSize)
  const textSize = useInkStore((s) => s.textSize)
  const setTool = useInkStore((s) => s.setTool)
  const setEraserMode = useInkStore((s) => s.setEraserMode)
  const setEraserSize = useInkStore((s) => s.setEraserSize)
  const setTextSize = useInkStore((s) => s.setTextSize)
  const [lastShape, setLastShape] = useState<ShapeTool>('line')

  const shownShape = isShapeTool(tool) ? tool : lastShape
  const { label: shapeLabel, Icon: ShapeIcon } = SHAPES[shownShape]
  const zoom = active?.zoom ?? 1

  return (
    <div className="draw-ribbon">
      <div className="draw-ribbon-tools" role="toolbar" aria-label="Drawing tools">
        <PenGallery />
        <span className="ink-sep" aria-hidden />
        <ToolFlyout
          className="ink-tool"
          active={tool === 'eraser'}
          onActivate={() => setTool('eraser')}
          label="Eraser"
          title="Eraser (E)"
          icon={<Eraser size={ICON_SIZE} />}
        >
          <div className="ink-flyout-body">
            <div className="ink-flyout-row" role="group" aria-label="Eraser mode">
              {ERASER_MODES.map(({ id, label, hint }) => (
                <button
                  key={id}
                  type="button"
                  className={`ink-tool ink-mode${eraserMode === id ? ' active' : ''}`}
                  onClick={() => setEraserMode(id)}
                  aria-pressed={eraserMode === id}
                  aria-label={hint}
                  title={hint}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="ink-flyout-row">
              <span>Size</span>
              <input
                type="range"
                min={4}
                max={80}
                value={eraserSize}
                onChange={(e) => setEraserSize(Number(e.target.value))}
                aria-label="Eraser size"
              />
            </label>
          </div>
        </ToolFlyout>
        <button
          type="button"
          className={`ink-tool${tool === 'lasso' ? ' active' : ''}`}
          onClick={() => setTool('lasso')}
          aria-pressed={tool === 'lasso'}
          aria-label="Lasso select"
          title="Lasso select (L)"
        >
          <Lasso size={ICON_SIZE} />
        </button>
        {active?.hasSelection && (
          <button
            type="button"
            className="ink-tool ink-delete"
            onClick={active.deleteSelected}
            aria-label="Delete selection"
            title="Delete selection (Del)"
          >
            <Trash2 size={ICON_SIZE} />
          </button>
        )}
        <ToolFlyout
          className="ink-tool"
          active={tool === 'text'}
          onActivate={() => setTool('text')}
          label="Text"
          title="Text (T)"
          icon={<Type size={ICON_SIZE} />}
        >
          {/* Independent of pen size: a comfortable stroke width and a legible
              font size are different scales. */}
          <label className="ink-flyout-row">
            <span>Size</span>
            <input
              type="range"
              min={8}
              max={72}
              value={textSize}
              onChange={(e) => setTextSize(Number(e.target.value))}
              aria-label="Text size"
            />
          </label>
        </ToolFlyout>
        <button
          type="button"
          className={`ink-tool${active?.rulerOn ? ' active' : ''}`}
          onClick={active?.toggleRuler}
          aria-pressed={active?.rulerOn ?? false}
          aria-label="Ruler"
          title="Ruler — draw along its edge; drag the middle to slide it, an end to swing it"
        >
          <RulerIcon size={ICON_SIZE} />
        </button>
        <button
          type="button"
          className="ink-tool"
          onClick={active?.cropToContent}
          aria-label="Crop to content"
          title="Crop to content — trim the empty page around your drawing"
        >
          <Crop size={ICON_SIZE} />
        </button>
        <ToolFlyout
          className="ink-tool"
          active={isShapeTool(tool)}
          onActivate={() => setTool(lastShape)}
          label="Shapes"
          title={`Shapes — ${shapeLabel}`}
          icon={<ShapeIcon size={ICON_SIZE} />}
        >
          <div className="ink-flyout-row" role="group" aria-label="Shape">
            {SHAPE_IDS.map((id) => {
              const { label, Icon } = SHAPES[id]
              return (
                <PopoverClose key={id} asChild>
                  <button
                    type="button"
                    className={`ink-tool${tool === id ? ' active' : ''}`}
                    onClick={() => {
                      setLastShape(id)
                      setTool(id)
                    }}
                    aria-pressed={tool === id}
                    aria-label={label}
                    title={label}
                  >
                    <Icon size={ICON_SIZE} />
                  </button>
                </PopoverClose>
              )
            })}
          </div>
        </ToolFlyout>
      </div>
      <div className="draw-ribbon-pinned">
        <button type="button" className="ink-tool" onClick={active?.undo} disabled={!active?.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 size={ICON_SIZE} />
        </button>
        <button type="button" className="ink-tool" onClick={active?.redo} disabled={!active?.canRedo} aria-label="Redo" title="Redo (Ctrl+Y)">
          <Redo2 size={ICON_SIZE} />
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="ink-tool ink-zoom-btn" aria-label="Zoom" title="Zoom">
              {Math.round(zoom * 100)}%
            </button>
          </PopoverTrigger>
          <PopoverContent className="ink-flyout" align="end" sideOffset={6}>
            <div className="ink-flyout-body">
              {ZOOM_LEVELS.map((level) => (
                <PopoverClose key={level} asChild>
                  <button
                    type="button"
                    className={`ink-tool ink-mode${zoom === level ? ' active' : ''}`}
                    onClick={() => active?.setZoom(level)}
                    aria-pressed={zoom === level}
                  >
                    {Math.round(level * 100)}%
                  </button>
                </PopoverClose>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <button type="button" className="dialog-action-primary ink-editor-done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}
