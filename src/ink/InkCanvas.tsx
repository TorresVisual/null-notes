import { useRef, useState, useEffect, useCallback } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useInkCanvas, isEraserTip } from './useInkCanvas'
import { pinchZoom, distanceBetween } from './zoom'
import { useInkStore } from '../store/ink'
import type { CanvasHandle } from '../store/ink'

// Dragging a finger moves the content with it, so the scroll offset goes the
// opposite way. Vertical travel belongs to the note; horizontal only matters
// once zoom has made the canvas wider than the column.
function scrollAncestors(from: HTMLElement, dx: number, dy: number): void {
  const page = from.closest('.editor-scroll')
  if (page) page.scrollTop -= dy
  const canvas = from.closest('.ink-canvas-wrap')
  if (canvas) canvas.scrollLeft -= dx
}

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
    hasSelection,
    deleteSelected,
    eraserSize,
    ruler,
    toggleRuler,
    grabRuler,
    dragRuler,
    releaseRuler,
    inkData,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useInkCanvas(svgPath, width, height, { zoom, autoGrow })

  const setActiveCanvas = useInkStore((s) => s.setActiveCanvas)
  const clearActiveCanvas = useInkStore((s) => s.clearActiveCanvas)
  // Whether *this* canvas is the active one — derived from the store, not a
  // manually-toggled ref. This is what makes exclusivity automatic: the instant
  // another canvas calls `setActiveCanvas`, every other canvas's `isActive`
  // recomputes to `false` on its own next render, with no cleanup step to
  // remember. `svgPath` is this canvas's stable identity: one file per canvas.
  const isActive = useInkStore((s) => s.activeCanvasId === svgPath)

  const handle = useCallback(
    (): CanvasHandle => ({
      undo,
      redo,
      canUndo,
      canRedo,
      deleteSelected,
      hasSelection,
      toggleRuler,
      rulerOn: ruler !== null,
      zoom,
      setZoom: (next: number) => onZoomChange?.(next),
    }),
    [undo, redo, canUndo, canRedo, deleteSelected, hasSelection, toggleRuler, ruler, zoom, onZoomChange],
  )

  // Re-registered whenever a value the bar renders changes, so `canUndo` in the
  // toolbar tracks the stroke that was just drawn rather than the state when the
  // pen first touched down — but only while this canvas actually owns the slot.
  useEffect(() => {
    if (isActive) setActiveCanvas(svgPath, handle())
  }, [isActive, handle, setActiveCanvas, svgPath])

  // Safe to call unconditionally on every unmount: `clearActiveCanvas` only
  // clears if `svgPath` still owns the slot, so a canvas that already lost it
  // to another one cannot wipe out that canvas's live registration.
  useEffect(() => () => clearActiveCanvas(svgPath), [clearActiveCanvas, svgPath])

  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  // Fingers never draw — the pen owns the ink — so touch is free to mean
  // everything else: hold the straightedge, drag the page, pinch to see more.
  // That is the paper division of labour, one hand positioning and one writing.
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)
  // Which finger, if any, is holding the straightedge. It is kept out of the
  // touches map so it can neither scroll the page nor count towards a pinch.
  const rulerTouch = useRef<number | null>(null)

  function pagePoint(target: HTMLElement, clientX: number, clientY: number) {
    const rect = target.getBoundingClientRect()
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    setActiveCanvas(svgPath, handle())

    if (e.pointerType !== 'touch') return

    const { x, y } = pagePoint(e.currentTarget, e.clientX, e.clientY)
    if (rulerTouch.current === null && grabRuler(x, y)) {
      rulerTouch.current = e.pointerId
      return
    }

    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (rulerTouch.current === e.pointerId) {
      rulerTouch.current = null
      releaseRuler()
    }
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinch.current = null
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') {
      if (rulerTouch.current === e.pointerId) {
        const { x, y } = pagePoint(e.currentTarget, e.clientX, e.clientY)
        dragRuler(x, y)
        return
      }

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
  const eraserDiameter = eraserSize * zoom

  return (
    <div className="ink-canvas-wrap">
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
