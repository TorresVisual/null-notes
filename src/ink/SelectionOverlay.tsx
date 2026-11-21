import { Copy, Trash2 } from 'lucide-react'
import { worldToScreen } from './camera'
import type { Camera } from './camera'
import type { Bounds } from './bounds'

const BAR_GAP = 36

interface SelectionOverlayProps {
  frame: Bounds
  camera: Camera
  toWorld: (e: { clientX: number; clientY: number }) => { x: number; y: number }
  onDuplicate: () => void
  onDelete: () => void
  onResizeStart: () => void
  onResize: (x: number, y: number) => void
  onResizeEnd: () => void
}

export function SelectionOverlay({
  frame,
  camera,
  toWorld,
  onDuplicate,
  onDelete,
  onResizeStart,
  onResize,
  onResizeEnd,
}: SelectionOverlayProps) {
  const topLeft = worldToScreen(camera, frame.minX, frame.minY)
  const corner = worldToScreen(camera, frame.maxX, frame.maxY)

  return (
    <>
      {/* Pointer-down stops here so a finger on a button is not read as the
          start of a canvas pan by the wrapper's touch handling. */}
      <div
        className="ink-selection-bar"
        style={{ left: topLeft.x, top: Math.max(4, topLeft.y - BAR_GAP) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onDuplicate} aria-label="Duplicate selection" title="Duplicate">
          <Copy size={14} />
        </button>
        <button type="button" className="danger" onClick={onDelete} aria-label="Delete selection" title="Delete (Del)">
          <Trash2 size={14} />
        </button>
      </div>
      <div
        className="ink-resize-handle"
        style={{ left: corner.x, top: corner.y, touchAction: 'none' }}
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture?.(e.pointerId)
          onResizeStart()
        }}
        onPointerMove={(e) => {
          const { x, y } = toWorld(e)
          onResize(x, y)
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture?.(e.pointerId)
          onResizeEnd()
        }}
        onPointerCancel={onResizeEnd}
      />
    </>
  )
}
