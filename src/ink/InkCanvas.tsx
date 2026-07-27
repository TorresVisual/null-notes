import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { PenLine, Eraser, Minus, Circle, Square, MoveUpRight, Undo2, Redo2 } from 'lucide-react'
import { useInkCanvas, isEraserTip } from './useInkCanvas'
import { pinchZoom, distanceBetween } from './zoom'
import type { Tool } from './types'

const TOOLS: { id: Tool; label: string; Icon: typeof PenLine }[] = [
  { id: 'pen', label: 'Pen', Icon: PenLine },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'arrow', label: 'Arrow', Icon: MoveUpRight },
]

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
      if (!touches.current.has(e.pointerId)) return
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const [a, b] = [...touches.current.values()]
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
        <span className="ink-sep" aria-hidden />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Stroke color"
        />
        <input
          type="range"
          min={1}
          max={20}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          aria-label="Stroke size"
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
