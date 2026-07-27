import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  PenLine,
  Eraser,
  Lasso,
  Minus,
  Circle,
  Square,
  MoveUpRight,
  Trash2,
  Undo2,
  Redo2,
} from 'lucide-react'
import { useInkCanvas, isEraserTip } from './useInkCanvas'
import { pinchZoom, distanceBetween } from './zoom'
import type { Tool } from './types'

const TOOLS: { id: Tool; label: string; Icon: typeof PenLine }[] = [
  { id: 'pen', label: 'Pen', Icon: PenLine },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
  { id: 'lasso', label: 'Lasso select', Icon: Lasso },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'arrow', label: 'Arrow', Icon: MoveUpRight },
]

// Dragging a finger moves the content with it, so the scroll offset goes the
// opposite way. Vertical travel belongs to the note; horizontal only matters
// once zoom has made the canvas wider than the column.
function scrollAncestors(from: HTMLElement, dx: number, dy: number): void {
  const page = from.closest('.editor-scroll')
  if (page) page.scrollTop -= dy
  const canvas = from.closest('.ink-canvas-wrap')
  if (canvas) canvas.scrollLeft -= dx
}

// A swatch that scaled 1:1 with pen size would make a 20px highlighter swallow
// its button and a 2px nib vanish, so the range is compressed, not mapped.
function swatchDiameter(size: number): number {
  return Math.round(5 + size * 0.5)
}

const ZOOM_LEVELS = [0.75, 1, 1.5, 2]
// Must match the grid background-size in index.css so it scales with zoom.
const GRID_SIZE = 24

interface InkCanvasProps {
  svgPath: string
  width: number
  height: number
  zoom?: number
  onZoomChange?: (zoom: number) => void
  autoGrow?: boolean
}

export function InkCanvas({
  svgPath,
  width,
  height,
  zoom = 1,
  onZoomChange,
  autoGrow = false,
}: InkCanvasProps) {
  const {
    canvasRef,
    tool,
    setTool,
    hasSelection,
    deleteSelected,
    pens,
    activePenId,
    selectPen,
    color,
    setColor,
    size,
    setSize,
    inkData,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useInkCanvas(svgPath, width, height, { zoom, autoGrow })

  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  // Fingers never draw — the pen owns the ink — so touch is free to mean
  // zoom, which is how you actually work: write, then pinch to see more.
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch') return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinch.current = null
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') {
      const previous = touches.current.get(e.pointerId)
      if (!previous) return
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const points = [...touches.current.values()]

      // One finger drags the page. This is done by hand rather than by letting
      // touch-action scroll natively, because touch-action governs pen input
      // too — allowing a native pan would make the pen scroll instead of draw.
      if (points.length === 1) {
        scrollAncestors(e.currentTarget, e.clientX - previous.x, e.clientY - previous.y)
        return
      }

      const [a, b] = points
      if (!a || !b || !onZoomChange) return
      const distance = distanceBetween(a, b)
      if (!pinch.current) pinch.current = { distance, zoom }
      else onZoomChange(pinchZoom(pinch.current.zoom, pinch.current.distance, distance))
      return
    }

    // The eraser end of the pen erases without changing the selected tool, so
    // the cursor has to follow the hardware, not just the toolbar.
    const erasing = e.pointerType === 'pen' && (tool === 'eraser' || isEraserTip(e))
    if (!erasing) {
      if (cursorPos) setCursorPos(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  function handlePointerLeave() {
    setCursorPos(null)
  }

  // Size from the ink data, not the props — the page grows as you write, and
  // zoom scales what you see without touching the stored coordinates.
  const displayWidth = inkData.width * zoom
  const displayHeight = inkData.height * zoom
  const eraserDiameter = size * 6 * zoom

  return (
    <div className="ink-canvas-wrap">
      <div className="ink-toolbar" role="toolbar" aria-label="Drawing tools">
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
          onChange={(e) => setColor(e.target.value)}
          aria-label="Pen color"
        />
        <input
          type="range"
          min={1}
          max={24}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          aria-label="Pen size"
        />
        <span className="ink-sep" aria-hidden />
        <button className="ink-tool" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo">
          <Undo2 size={15} />
        </button>
        <button className="ink-tool" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo">
          <Redo2 size={15} />
        </button>
        {onZoomChange && (
          <>
            <span className="ink-sep" aria-hidden />
            {ZOOM_LEVELS.map((level) => (
              <button
                key={level}
                className={`ink-tool ink-zoom${zoom === level ? ' active' : ''}`}
                onClick={() => onZoomChange(level)}
                aria-pressed={zoom === level}
                aria-label={`Zoom ${level}x`}
                title={`Zoom ${level}x`}
              >
                {level}×
              </button>
            ))}
          </>
        )}
      </div>
      <div
        style={{ position: 'relative', width: displayWidth, height: displayHeight }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      >
        <canvas
          ref={canvasRef}
          className="ink-canvas"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: displayWidth,
            height: displayHeight,
            backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
            touchAction: 'none',
          }}
        />
        {cursorPos && (
          <div
            className="ink-eraser-cursor"
            style={{
              left: cursorPos.x,
              top: cursorPos.y,
              width: eraserDiameter,
              height: eraserDiameter,
            }}
          />
        )}
      </div>
    </div>
  )
}
