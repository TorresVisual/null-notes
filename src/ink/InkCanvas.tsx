import { useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { PenLine, Eraser, Minus, Circle, Square, MoveUpRight, Undo2, Redo2 } from 'lucide-react'
import { useInkCanvas } from './useInkCanvas'
import type { Tool } from './types'

const TOOLS: { id: Tool; label: string; Icon: typeof PenLine }[] = [
  { id: 'pen', label: 'Pen', Icon: PenLine },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'arrow', label: 'Arrow', Icon: MoveUpRight },
]

interface InkCanvasProps {
  svgPath: string
  width: number
  height: number
}

export function InkCanvas({ svgPath, width, height }: InkCanvasProps) {
  const {
    canvasRef,
    tool,
    setTool,
    color,
    setColor,
    size,
    setSize,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useInkCanvas(svgPath, width, height)

  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'pen' || tool !== 'eraser') {
      if (cursorPos) setCursorPos(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  function handlePointerLeave() {
    setCursorPos(null)
  }

  const eraserDiameter = size * 6

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
      </div>
      <div
        style={{ position: 'relative', width, height }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <canvas
          ref={canvasRef}
          className="ink-canvas"
          style={{ position: 'absolute', top: 0, left: 0, width, height, touchAction: 'none' }}
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
