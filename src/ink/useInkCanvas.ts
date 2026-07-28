import { useRef, useState, useEffect, useCallback } from 'react'
import { getStroke } from 'perfect-freehand'
import { inkApi } from '../lib/ink'
import { erasePoint } from './pointEraser'
import { drawShapePreview } from './shapePreview'
import { paintOrder } from './paintOrder'
import {
  EMPTY_SELECTION,
  isSelectionEmpty,
  pointInPolygon,
  selectionIn,
  selectionBottom,
  translatePolygon,
  translateSelection,
  deleteSelection as removeSelection,
} from './lasso'
import type { LassoPoint, Selection } from './lasso'
import {
  DEFAULT_PENS,
  loadPens,
  savePens,
  loadActivePenId,
  saveActivePenId,
  loadEraserSize,
  saveEraserSize,
  clampEraserSize,
  withPen,
} from './pens'
import type { PreviewShape } from './shapePreview'
import type { InkData, Stroke, Shape, Tool, Point, Pen } from './types'

const SHAPE_TOOLS: Tool[] = ['line', 'circle', 'rect', 'arrow']
const STROKE_OPTIONS = { thinning: 0.5, smoothing: 0.5, streamline: 0.5 }

// A page grows when you write near its bottom edge and never shrinks on its
// own — reclaiming space has to be deliberate, or growth could drop strokes.
const GROW_MARGIN = 160
const PAGE_STEP = 400

const LASSO_COLOR = 'rgba(126, 231, 135, 0.9)'

interface InkOptions {
  zoom?: number
  autoGrow?: boolean
}

function grownHeight(height: number, points: Point[], autoGrow: boolean): number {
  if (!autoGrow) return height
  const lowest = points.reduce((max, p) => Math.max(max, p.y), 0)
  return lowest > height - GROW_MARGIN ? height + PAGE_STEP : height
}

// Pointer Events reports the pen's eraser end as bit 5 of `buttons` (32) for
// as long as it is down, but `button` only says 5 on the down and up events —
// between them it is -1. Checking both is what makes flipping the pen over
// erase instead of draw.
const ERASER_BUTTON = 5
const ERASER_BUTTONS_MASK = 32

interface PointerLike {
  button: number
  buttons: number
}

export function isEraserTip(e: PointerLike): boolean {
  return (e.buttons & ERASER_BUTTONS_MASK) !== 0 || e.button === ERASER_BUTTON
}

function isShapeTool(tool: Tool): boolean {
  return SHAPE_TOOLS.includes(tool)
}

function fillStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  size: number,
  opacity: number,
): void {
  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.pressure]),
    { size, ...STROKE_OPTIONS },
  )
  const first = outline[0]
  if (!first) return
  ctx.beginPath()
  ctx.fillStyle = color
  ctx.globalAlpha = opacity
  ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
  for (let i = 1; i < outline.length; i++) {
    const point = outline[i]
    if (point) ctx.lineTo(point[0] ?? 0, point[1] ?? 0)
  }
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
}

// The lasso and the marquee it becomes are drawn the same way — a dashed loop.
// Nothing about it is ever serialised: a selection is a thing you are holding,
// not a thing the note contains.
function strokeLasso(ctx: CanvasRenderingContext2D, polygon: LassoPoint[], closed: boolean): void {
  const first = polygon[0]
  if (!first) return
  ctx.save()
  ctx.beginPath()
  ctx.setLineDash([6, 4])
  ctx.lineWidth = 1
  ctx.strokeStyle = LASSO_COLOR
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < polygon.length; i++) {
    const p = polygon[i]
    if (p) ctx.lineTo(p.x, p.y)
  }
  if (closed) ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

// Losing a stroke because the pen crossed the canvas edge mid-drag is worse
// than any capture quirk, but jsdom and some webviews lack the API entirely.
function capturePointer(canvas: HTMLCanvasElement | null, pointerId: number): void {
  try {
    canvas?.setPointerCapture(pointerId)
  } catch {
    // no capture support — strokes still work, they just end at the edge
  }
}

function releasePointer(canvas: HTMLCanvasElement | null, pointerId: number): void {
  try {
    if (canvas?.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
  } catch {
    // see capturePointer
  }
}

export function useInkCanvas(
  svgPath: string,
  width: number,
  height: number,
  { zoom = 1, autoGrow = false }: InkOptions = {},
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [pens, setPens] = useState<Pen[]>(loadPens)
  const [activePenId, setActivePenId] = useState(() => loadActivePenId(loadPens()))
  const [inkData, setInkData] = useState<InkData>({ width, height, strokes: [], shapes: [] })
  const [history, setHistory] = useState<InkData[]>([])
  const [future, setFuture] = useState<InkData[]>([])

  const [eraserSize, setEraserSizeState] = useState(loadEraserSize)
  const [lassoPolygon, setLassoPolygon] = useState<LassoPoint[] | null>(null)
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)

  const currentStroke = useRef<Point[]>([])
  const shapeStart = useRef<{ x: number; y: number } | null>(null)
  const eraseSnapshot = useRef<InkData | null>(null)
  const lassoPath = useRef<LassoPoint[]>([])
  const dragSnapshot = useRef<InkData | null>(null)
  const dragFrom = useRef<LassoPoint | null>(null)

  // The selected preset *is* the pen — colour, width and opacity all come from
  // it, and the toolbar's colour and size controls edit it in place. That is
  // what makes a pen you configured still be there in tomorrow's lecture.
  const activePen = pens.find((p) => p.id === activePenId) ?? DEFAULT_PENS[0]
  const { color, size, opacity } = activePen

  const updateActivePen = useCallback(
    (changes: Partial<Pen>) => {
      setPens((current) => {
        const updated = withPen(current, { ...activePen, ...changes })
        savePens(updated)
        return updated
      })
    },
    [activePen],
  )

  const setColor = useCallback(
    (next: string) => updateActivePen({ color: next }),
    [updateActivePen],
  )
  const setSize = useCallback(
    (next: number) => updateActivePen({ size: next }),
    [updateActivePen],
  )

  const setEraserSize = useCallback((next: number) => {
    const clamped = clampEraserSize(next)
    setEraserSizeState(clamped)
    saveEraserSize(clamped)
  }, [])

  const clearSelection = useCallback(() => {
    lassoPath.current = []
    setLassoPolygon(null)
    setSelection(EMPTY_SELECTION)
  }, [])

  // Reaching for another tool means you are done with what you were holding —
  // a marquee left floating over the page would only be in the way.
  const selectTool = useCallback(
    (next: Tool) => {
      setTool(next)
      clearSelection()
    },
    [clearSelection],
  )

  const selectPen = useCallback(
    (id: string) => {
      setActivePenId(id)
      saveActivePenId(id)
      selectTool('pen')
    },
    [selectTool],
  )

  useEffect(() => {
    inkApi.read(svgPath).then((data) => {
      if (data) setInkData(data)
    })
  }, [svgPath])

  const commit = useCallback(
    (next: InkData) => {
      setHistory((past) => [...past, inkData])
      setFuture([])
      setInkData(next)
      void inkApi.write(svgPath, next)
    },
    [inkData, svgPath],
  )

  const undo = useCallback(() => {
    const previous = history[history.length - 1]
    if (!previous) return
    setHistory(history.slice(0, -1))
    setFuture([...future, inkData])
    setInkData(previous)
    void inkApi.write(svgPath, previous)
  }, [history, future, inkData, svgPath])

  const redo = useCallback(() => {
    const next = future[future.length - 1]
    if (!next) return
    setFuture(future.slice(0, -1))
    setHistory([...history, inkData])
    setInkData(next)
    void inkApi.write(svgPath, next)
  }, [history, future, inkData, svgPath])

  const redrawCanvas = useCallback(
    (livePoints: Point[], liveShape?: PreviewShape | null, liveLasso?: LassoPoint[] | null) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Back the canvas with real device pixels — at 1x on a HiDPI pen display
      // every stroke is drawn into a half-resolution buffer and upscaled. Zoom
      // multiplies in here so magnified ink is redrawn, not stretched.
      const dpr = (window.devicePixelRatio || 1) * zoom
      const pixelWidth = Math.round(inkData.width * dpr)
      const pixelHeight = Math.round(inkData.height * dpr)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, inkData.width, inkData.height)

      for (const stroke of paintOrder(inkData.strokes)) {
        fillStroke(ctx, stroke.points, stroke.color, stroke.size, stroke.opacity)
      }
      for (const shape of inkData.shapes) {
        drawShapePreview(ctx, shape)
      }
      if (livePoints.length > 1) {
        fillStroke(ctx, livePoints, color, size, opacity)
      }
      if (liveShape) {
        drawShapePreview(ctx, liveShape)
      }
      if (liveLasso) {
        strokeLasso(ctx, liveLasso, false)
      } else if (lassoPolygon) {
        strokeLasso(ctx, lassoPolygon, true)
      }
    },
    [inkData, color, size, opacity, zoom, lassoPolygon],
  )

  useEffect(() => {
    redrawCanvas([])
  }, [inkData, redrawCanvas])

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const radius = eraserSize / 2
      setInkData((data) => erasePoint(data, x, y, radius, () => crypto.randomUUID()))
    },
    [eraserSize],
  )

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      capturePointer(canvasRef.current, e.pointerId)
      const activeTool = isEraserTip(e) ? 'eraser' : tool

      if (activeTool === 'eraser') {
        eraseSnapshot.current = inkData
        eraseAt(e.offsetX / zoom, e.offsetY / zoom)
        return
      }

      if (activeTool === 'lasso') {
        const x = e.offsetX / zoom
        const y = e.offsetY / zoom

        // Landing inside a marquee you already drew means "move this", not
        // "start again" — which is the only way to reposition without a
        // separate move tool.
        if (lassoPolygon && !isSelectionEmpty(selection) && pointInPolygon(x, y, lassoPolygon)) {
          dragSnapshot.current = inkData
          dragFrom.current = { x, y }
          return
        }

        clearSelection()
        lassoPath.current = [{ x, y }]
        return
      }

      if (isShapeTool(activeTool)) {
        shapeStart.current = { x: e.offsetX / zoom, y: e.offsetY / zoom }
        return
      }
      currentStroke.current = [{ x: e.offsetX / zoom, y: e.offsetY / zoom, pressure: e.pressure }]
    },
    [tool, inkData, eraseAt, zoom, lassoPolygon, selection, clearSelection],
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      const activeTool = isEraserTip(e) ? 'eraser' : tool

      if (activeTool === 'eraser') {
        // Only while the tip is actually down — hovering must not erase.
        if (eraseSnapshot.current) eraseAt(e.offsetX / zoom, e.offsetY / zoom)
        return
      }

      if (activeTool === 'lasso') {
        const x = e.offsetX / zoom
        const y = e.offsetY / zoom

        // The move is applied to the ink as it happens rather than previewed,
        // so a released pen has nothing left to reconcile. History and the file
        // wait for pointerup — one entry per drag, not one per sample.
        const from = dragFrom.current
        if (from) {
          const dx = x - from.x
          const dy = y - from.y
          dragFrom.current = { x, y }
          setInkData((data) => translateSelection(data, selection, dx, dy))
          setLassoPolygon((polygon) => (polygon ? translatePolygon(polygon, dx, dy) : polygon))
          return
        }

        if (lassoPath.current.length === 0) return
        lassoPath.current = [...lassoPath.current, { x, y }]
        redrawCanvas([], null, lassoPath.current)
        return
      }

      if (isShapeTool(activeTool)) {
        if (!shapeStart.current) return
        redrawCanvas([], {
          kind: activeTool as Shape['kind'],
          x1: shapeStart.current.x,
          y1: shapeStart.current.y,
          x2: e.offsetX / zoom,
          y2: e.offsetY / zoom,
          color,
          size,
        })
        return
      }

      if (currentStroke.current.length === 0) return
      const events = e.getCoalescedEvents?.() ?? [e]
      for (const ce of events) {
        currentStroke.current.push({
          x: ce.offsetX / zoom,
          y: ce.offsetY / zoom,
          pressure: ce.pressure,
        })
      }
      redrawCanvas(currentStroke.current)
    },
    [tool, size, color, eraseAt, redrawCanvas, zoom, selection],
  )

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      releasePointer(canvasRef.current, e.pointerId)

      // Closing the loop is what selects — the path is discarded either way and
      // only the resulting marquee is kept, so nothing about a lasso is undoable.
      if (lassoPath.current.length > 0) {
        const polygon = lassoPath.current
        lassoPath.current = []
        const found = selectionIn(inkData, polygon)
        setSelection(found)
        setLassoPolygon(isSelectionEmpty(found) ? null : polygon)
        return
      }

      // A move is one history entry and one write, however far the pen wandered.
      const dragged = dragSnapshot.current
      if (dragged) {
        dragSnapshot.current = null
        dragFrom.current = null
        if (inkData !== dragged) {
          setHistory((past) => [...past, dragged])
          setFuture([])
          const grown = {
            ...inkData,
            height: grownHeight(
              inkData.height,
              [{ x: 0, y: selectionBottom(inkData, selection), pressure: 0 }],
              autoGrow,
            ),
          }
          setInkData(grown)
          void inkApi.write(svgPath, grown)
        }
        return
      }

      // One history entry and one file write per erase drag, not per sample.
      const snapshot = eraseSnapshot.current
      if (snapshot) {
        eraseSnapshot.current = null
        if (inkData !== snapshot) {
          setHistory((past) => [...past, snapshot])
          setFuture([])
          void inkApi.write(svgPath, inkData)
        }
        return
      }

      if (shapeStart.current) {
        const shape: Shape = {
          id: crypto.randomUUID(),
          kind: tool as Shape['kind'],
          x1: shapeStart.current.x,
          y1: shapeStart.current.y,
          x2: e.offsetX / zoom,
          y2: e.offsetY / zoom,
          color,
          size,
        }
        shapeStart.current = null
        currentStroke.current = []
        const corners = [
          { x: shape.x1, y: shape.y1, pressure: 0 },
          { x: shape.x2, y: shape.y2, pressure: 0 },
        ]
        commit({
          ...inkData,
          height: grownHeight(inkData.height, corners, autoGrow),
          shapes: [...inkData.shapes, shape],
        })
        return
      }

      if (currentStroke.current.length < 2) {
        currentStroke.current = []
        return
      }

      const stroke: Stroke = {
        id: crypto.randomUUID(),
        points: currentStroke.current,
        color,
        size,
        opacity,
      }
      currentStroke.current = []
      commit({
        ...inkData,
        height: grownHeight(inkData.height, stroke.points, autoGrow),
        strokes: [...inkData.strokes, stroke],
      })
    },
    [tool, inkData, color, size, opacity, commit, svgPath, zoom, autoGrow, selection],
  )

  const deleteSelected = useCallback(() => {
    if (isSelectionEmpty(selection)) return
    commit(removeSelection(inkData, selection))
    clearSelection()
  }, [selection, inkData, commit, clearSelection])

  useEffect(() => {
    if (isSelectionEmpty(selection)) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      e.preventDefault()
      deleteSelected()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selection, deleteSelected])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointercancel', handlePointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [handlePointerDown, handlePointerMove, handlePointerUp])

  return {
    canvasRef,
    tool,
    setTool: selectTool,
    selection,
    hasSelection: !isSelectionEmpty(selection),
    deleteSelected,
    pens,
    activePenId,
    selectPen,
    color,
    setColor,
    size,
    setSize,
    eraserSize,
    setEraserSize,
    inkData,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
  }
}
