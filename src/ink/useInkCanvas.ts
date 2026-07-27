import { useRef, useState, useEffect, useCallback } from 'react'
import { getStroke } from 'perfect-freehand'
import { inkApi } from '../lib/ink'
import { hitTestShape } from './hitTest'
import { drawShapePreview } from './shapePreview'
import type { PreviewShape } from './shapePreview'
import type { InkData, Stroke, Shape, Tool, Point } from './types'

const SHAPE_TOOLS: Tool[] = ['line', 'circle', 'rect', 'arrow']
const STROKE_OPTIONS = { thinning: 0.5, smoothing: 0.5, streamline: 0.5 }

// The canvas sits on the app's near-black background, so ink defaults to the
// text colour — black ink here is invisible ink. A fine nib is what
// handwritten maths needs; the slider still reaches 20 for diagrams.
const DEFAULT_COLOR = '#e6edf3'
const DEFAULT_SIZE = 2

// A page grows when you write near its bottom edge and never shrinks on its
// own — reclaiming space has to be deliberate, or growth could drop strokes.
const GROW_MARGIN = 160
const PAGE_STEP = 400

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
): void {
  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.pressure]),
    { size, ...STROKE_OPTIONS },
  )
  const first = outline[0]
  if (!first) return
  ctx.beginPath()
  ctx.fillStyle = color
  ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
  for (let i = 1; i < outline.length; i++) {
    const point = outline[i]
    if (point) ctx.lineTo(point[0] ?? 0, point[1] ?? 0)
  }
  ctx.closePath()
  ctx.fill()
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
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [inkData, setInkData] = useState<InkData>({ width, height, strokes: [], shapes: [] })
  const [history, setHistory] = useState<InkData[]>([])
  const [future, setFuture] = useState<InkData[]>([])

  const currentStroke = useRef<Point[]>([])
  const shapeStart = useRef<{ x: number; y: number } | null>(null)
  const eraseSnapshot = useRef<InkData | null>(null)

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
    (livePoints: Point[], liveShape?: PreviewShape | null) => {
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

      for (const stroke of inkData.strokes) {
        fillStroke(ctx, stroke.points, stroke.color, stroke.size)
      }
      for (const shape of inkData.shapes) {
        drawShapePreview(ctx, shape)
      }
      if (livePoints.length > 1) {
        fillStroke(ctx, livePoints, color, size)
      }
      if (liveShape) {
        drawShapePreview(ctx, liveShape)
      }
    },
    [inkData, color, size, zoom],
  )

  useEffect(() => {
    redrawCanvas([])
  }, [inkData, redrawCanvas])

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const radius = size * 3
      setInkData((data) => {
        const strokes = data.strokes.filter((s) =>
          s.points.every((p) => Math.hypot(p.x - x, p.y - y) > radius),
        )
        const shapes = data.shapes.filter((s) => !hitTestShape(s, x, y, radius))
        if (strokes.length === data.strokes.length && shapes.length === data.shapes.length) {
          return data
        }
        return { ...data, strokes, shapes }
      })
    },
    [size],
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
      if (isShapeTool(activeTool)) {
        shapeStart.current = { x: e.offsetX / zoom, y: e.offsetY / zoom }
        return
      }
      currentStroke.current = [{ x: e.offsetX / zoom, y: e.offsetY / zoom, pressure: e.pressure }]
    },
    [tool, inkData, eraseAt, zoom],
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
    [tool, size, color, eraseAt, redrawCanvas, zoom],
  )

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      releasePointer(canvasRef.current, e.pointerId)

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
      }
      currentStroke.current = []
      commit({
        ...inkData,
        height: grownHeight(inkData.height, stroke.points, autoGrow),
        strokes: [...inkData.strokes, stroke],
      })
    },
    [tool, inkData, color, size, commit, svgPath, zoom, autoGrow],
  )

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
    setTool,
    color,
    setColor,
    size,
    setSize,
    inkData,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
  }
}
