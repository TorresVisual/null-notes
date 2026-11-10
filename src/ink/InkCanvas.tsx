import { useRef, useState, useEffect, useCallback } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useInkCanvas, isDrawingPointer, isEraserTip, toInk } from './useInkCanvas'
import { pinchZoom, distanceBetween } from './zoom'
import { panBy, zoomAbout, worldToScreen } from './camera'
import { inkBounds } from './bounds'
import type { Bounds } from './bounds'
import { useCamera } from '../hooks/useCamera'
import { useInkStore } from '../store/ink'
import type { CanvasHandle } from '../store/ink'
import type { InkBackdrop } from './InkEditorOverlay'
import type { InkData } from './types'

interface InkCanvasProps {
  svgPath: string
  backdrop?: InkBackdrop
  onSaved?: () => void
  autoActivate?: boolean
}

interface Pinch {
  distance: number
  scale: number
  midX: number
  midY: number
}

export function InkCanvas({ svgPath, backdrop, onSaved, autoActivate = false }: InkCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fitTo, setFitTo] = useState<Bounds | null>(null)
  const { camera, viewport, zoomToward, updateCamera } = useCamera(containerRef, fitTo)

  // Over a page backdrop the page is what you came to see, not the ink on it.
  const fitOnLoad = useCallback(
    (data: InkData) =>
      setFitTo(backdrop ? { minX: 0, minY: 0, maxX: backdrop.width, maxY: backdrop.height } : inkBounds(data)),
    [backdrop],
  )

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
    undo,
    redo,
    cropToContent,
    canUndo,
    canRedo,
    editingText,
    updateEditingText,
    commitEditingText,
    cancelEditingText,
  } = useInkCanvas(svgPath, { camera, viewport, backdrop, onSaved, onLoaded: fitOnLoad })

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
      zoom: camera.scale,
      setZoom: zoomToward,
      cropToContent,
    }),
    [undo, redo, cropToContent, canUndo, canRedo, deleteSelected, hasSelection, toggleRuler, ruler, camera.scale, zoomToward],
  )

  // Re-registered whenever a value the bar renders changes, so `canUndo` in the
  // toolbar tracks the stroke that was just drawn rather than the state when the
  // pen first touched down — but only while this canvas actually owns the slot.
  useEffect(() => {
    if (isActive) setActiveCanvas(svgPath, handle())
  }, [isActive, handle, setActiveCanvas, svgPath])

  // Mount-time only: the tool group renders nothing until a canvas has
  // registered, and registration otherwise waits for a pointer press. From here
  // the effect above keeps the handle fresh.
  useEffect(() => {
    if (autoActivate) setActiveCanvas(svgPath, handle())
  }, [autoActivate, svgPath])

  // Safe to call unconditionally on every unmount: `clearActiveCanvas` only
  // clears if `svgPath` still owns the slot, so a canvas that already lost it
  // to another one cannot wipe out that canvas's live registration.
  useEffect(() => () => clearActiveCanvas(svgPath), [clearActiveCanvas, svgPath])

  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  // Fingers never draw — the pen owns the ink — so touch is free to mean
  // everything else: hold the straightedge, drag the canvas, pinch to see more.
  // That is the paper division of labour, one hand positioning and one writing.
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<Pinch | null>(null)
  // Which finger, if any, is holding the straightedge. It is kept out of the
  // touches map so it can neither pan the canvas nor count towards a pinch.
  const rulerTouch = useRef<number | null>(null)

  function worldPoint(e: { clientX: number; clientY: number }) {
    return toInk(e, camera, containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 })
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    setActiveCanvas(svgPath, handle())

    if (e.pointerType !== 'touch') return

    const { x, y } = worldPoint(e)
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
        const { x, y } = worldPoint(e)
        dragRuler(x, y)
        return
      }

      const previous = touches.current.get(e.pointerId)
      if (!previous) return
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const points = [...touches.current.values()]

      // One finger drags the canvas. This is done by hand rather than by letting
      // touch-action pan natively, because touch-action governs pen input too —
      // allowing a native pan would make the pen scroll instead of draw.
      const [a, b] = points
      if (!a) return
      if (!b) {
        updateCamera((current) => panBy(current, e.clientX - previous.x, e.clientY - previous.y))
        return
      }

      const rect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
      const midX = (a.x + b.x) / 2 - rect.left
      const midY = (a.y + b.y) / 2 - rect.top
      const distance = distanceBetween(a, b)
      const start = pinch.current
      pinch.current = { distance: start?.distance ?? distance, scale: start?.scale ?? camera.scale, midX, midY }
      if (!start) return
      // The midpoint's own travel pans, then the spread zooms about where it
      // now is, so two fingers can move and scale at once.
      updateCamera((current) =>
        zoomAbout(
          panBy(current, midX - start.midX, midY - start.midY),
          midX,
          midY,
          pinchZoom(start.scale, start.distance, distance),
        ),
      )
      return
    }

    // The eraser end of the pen erases without changing the selected tool, so
    // the cursor has to follow the hardware, not just the toolbar.
    const erasing = isDrawingPointer(e) && (tool === 'eraser' || isEraserTip(e))
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

  const eraserDiameter = eraserSize * camera.scale
  const labelAt = editingText ? worldToScreen(camera, editingText.x, editingText.y) : null

  return (
    <div
      ref={containerRef}
      className="ink-canvas-wrap"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <canvas ref={canvasRef} className="ink-canvas" style={{ touchAction: 'none' }} />
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
      {editingText && labelAt && (
        <textarea
          key={editingText.id}
          className="ink-text-editor"
          autoFocus
          value={editingText.text}
          onChange={(e) => updateEditingText(e.target.value)}
          onBlur={commitEditingText}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              cancelEditingText()
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          rows={Math.max(1, editingText.text.split('\n').length)}
          wrap="off"
          style={{
            left: labelAt.x,
            top: labelAt.y,
            color: editingText.color,
            fontSize: editingText.size * camera.scale,
          }}
        />
      )}
    </div>
  )
}
