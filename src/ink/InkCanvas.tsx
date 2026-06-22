import { useInkCanvas } from './useInkCanvas'
import type { Tool } from './types'

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'pen', label: 'Pen' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'line', label: 'Line' },
  { id: 'circle', label: 'Circle' },
  { id: 'rect', label: 'Rect' },
  { id: 'arrow', label: 'Arrow' },
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

  return (
    <div className="ink-canvas-wrap">
      <div className="ink-toolbar" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`ink-tool${tool === t.id ? ' active' : ''}`}
            onClick={() => setTool(t.id)}
            aria-pressed={tool === t.id}
          >
            {t.label}
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
        <button onClick={undo} disabled={!canUndo} aria-label="Undo">↩</button>
        <button onClick={redo} disabled={!canRedo} aria-label="Redo">↪</button>
      </div>
      <div style={{ position: 'relative', width, height }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="ink-canvas"
          style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
        />
      </div>
    </div>
  )
}
