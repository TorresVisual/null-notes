import { useRef, useState, useEffect, useCallback } from 'react'
import { getStroke } from 'perfect-freehand'
import { inkApi } from '../lib/ink'
import { erase } from './pointEraser'
import {
  centredRuler,
  grabKind,
  moveRuler,
  rotateRulerTowards,
  shouldSnap,
  snapStroke,
  RULER_BAND,
} from './ruler'
import type { Ruler, RulerGrab } from './ruler'
import { drawShapePreview } from './shapePreview'
import { drawTextItem } from './textRender'
import { pointInTextItem, translateTextItem } from './textBounds'
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
import { useInkStore, activePenOf } from '../store/ink'
import type { PreviewShape } from './shapePreview'
import type { InkData, Stroke, Shape, TextItem, Tool, Point } from './types'

const SHAPE_TOOLS: Tool[] = ['line', 'circle', 'rect', 'arrow']

// A text item you are actively typing into — held outside `InkData` until it
// commits, the same way the lasso marquee is a thing you're holding rather
// than a thing the note contains. Discarding it (Escape) is then just
// clearing this state: an edited existing item was never mutated in place,
// and a fresh one was never added.
export interface EditingText {
  id: string
  x: number
  y: number
  text: string
  color: string
  size: number
  isNew: boolean
}

// A tap that drifted a pixel or two while landing should still open the
// editor, not start a drag — the same "judge intent once" posture the ruler
// snap decision already uses.
const TEXT_DRAG_THRESHOLD = 3
const DEFAULT_THINNING = 0.5
const STROKE_OPTIONS = { smoothing: 0.5, streamline: 0.5 }

// A page grows when you write near its bottom edge and never shrinks on its
// own — reclaiming space has to be deliberate, or growth could drop strokes.
const GROW_MARGIN = 160
const PAGE_STEP = 400

const LASSO_COLOR = 'rgba(126, 231, 135, 0.9)'

const RULER_FILL = 'rgba(121, 192, 255, 0.10)'
const RULER_EDGE = 'rgba(121, 192, 255, 0.8)'
const RULER_TICK = 24

// The ruler is drawn, never stored — like the lasso marquee, it is a thing you
// are holding rather than a thing the note contains. Ticks come every grid
// square so the straightedge measures in the same units the page is ruled in.
function drawRuler(ctx: CanvasRenderingContext2D, ruler: Ruler): void {
  const half = ruler.length / 2
  ctx.save()
  ctx.translate(ruler.x, ruler.y)
  ctx.rotate(ruler.angle)

  ctx.fillStyle = RULER_FILL
  ctx.fillRect(-half, -RULER_BAND / 2, ruler.length, RULER_BAND)

  ctx.strokeStyle = RULER_EDGE
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-half, 0)
  ctx.lineTo(half, 0)
  ctx.stroke()

  ctx.lineWidth = 1
  ctx.beginPath()
  for (let d = 0; d <= half; d += RULER_TICK) {
    const long = d % (RULER_TICK * 4) === 0
    const tick = long ? RULER_BAND / 2 : RULER_BAND / 4
    for (const x of [d, -d]) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, tick)
    }
  }
  ctx.stroke()

  // The ends are the handles that swing it, so they are drawn as handles.
  ctx.fillStyle = RULER_EDGE
  for (const x of [-half, half]) {
    ctx.beginPath()
    ctx.arc(x, 0, 5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

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
  thinning: number = DEFAULT_THINNING,
): void {
  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.pressure]),
    { size, thinning, ...STROKE_OPTIONS },
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
  const tool = useInkStore((s) => s.tool)
  const pens = useInkStore((s) => s.pens)
  const activePenId = useInkStore((s) => s.activePenId)
  const eraserMode = useInkStore((s) => s.eraserMode)
  const eraserSize = useInkStore((s) => s.eraserSize)
  const textSize = useInkStore((s) => s.textSize)
  const setToolInStore = useInkStore((s) => s.setTool)
  const selectPenInStore = useInkStore((s) => s.selectPen)
  const updateActivePen = useInkStore((s) => s.updateActivePen)
  const setEraserMode = useInkStore((s) => s.setEraserMode)
  const setEraserSize = useInkStore((s) => s.setEraserSize)
  const [inkData, setInkData] = useState<InkData>({ width, height, strokes: [], shapes: [], texts: [] })
  const [history, setHistory] = useState<InkData[]>([])
  const [future, setFuture] = useState<InkData[]>([])

  const [ruler, setRuler] = useState<Ruler | null>(null)
  const [lassoPolygon, setLassoPolygon] = useState<LassoPoint[] | null>(null)
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const [editingText, setEditingText] = useState<EditingText | null>(null)

  const currentStroke = useRef<Point[]>([])
  const shapeStart = useRef<{ x: number; y: number } | null>(null)
  const eraseSnapshot = useRef<InkData | null>(null)
  const lassoPath = useRef<LassoPoint[]>([])
  const rulerGrab = useRef<{ kind: RulerGrab; x: number; y: number } | null>(null)
  const snapping = useRef(false)
  const dragSnapshot = useRef<InkData | null>(null)
  const dragFrom = useRef<LassoPoint | null>(null)
  const textDragFrom = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null)
  const textDragSnapshot = useRef<InkData | null>(null)

  // Mirrored into refs so an unmount can flush an in-progress edit without a
  // stale closure — the note-editor's own flush-on-unmount rule (P0-1),
  // applied here because a typed-but-not-yet-blurred label is exactly the
  // kind of edit principle #3 says must not vanish silently.
  const editingTextRef = useRef<EditingText | null>(null)
  useEffect(() => {
    editingTextRef.current = editingText
  }, [editingText])
  const inkDataRef = useRef(inkData)
  useEffect(() => {
    inkDataRef.current = inkData
  }, [inkData])

  // The selected preset *is* the pen — colour, width and opacity all come from
  // it, and the toolbar's colour and size controls edit it in place. That is
  // what makes a pen you configured still be there in tomorrow's lecture.
  const activePen = activePenOf({ pens, activePenId })
  const { color, size, opacity, thinning } = activePen

  const setColor = useCallback(
    (next: string) => updateActivePen({ color: next }),
    [updateActivePen],
  )
  const setSize = useCallback(
    (next: number) => updateActivePen({ size: next }),
    [updateActivePen],
  )

  // The ruler arrives lying across the middle of the page you are looking at,
  // not the middle of a page that has grown to twice the screen.
  const toggleRuler = useCallback(() => {
    setRuler((current) => (current ? null : centredRuler(inkData.width, height)))
  }, [inkData.width, height])

  const clearSelection = useCallback(() => {
    lassoPath.current = []
    setLassoPolygon(null)
    setSelection(EMPTY_SELECTION)
  }, [])

  const selectTool = useCallback((next: Tool) => setToolInStore(next), [setToolInStore])
  const selectPen = useCallback((id: string) => selectPenInStore(id), [selectPenInStore])

  // The tool is shared, the selection is not: switching tools has to clear the
  // selection in *every* canvas, not only the one whose button was pressed, or a
  // lasso selection in another block outlives the tool that made it.
  useEffect(() => {
    clearSelection()
  }, [tool, clearSelection])

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

  const startNewText = useCallback(
    (x: number, y: number) => {
      setEditingText({ id: crypto.randomUUID(), x, y, text: '', color, size: textSize, isNew: true })
    },
    [color, textSize],
  )

  const startEditText = useCallback((item: TextItem) => {
    setEditingText({ id: item.id, x: item.x, y: item.y, text: item.text, color: item.color, size: item.size, isNew: false })
  }, [])

  const updateEditingText = useCallback((text: string) => {
    setEditingText((current) => (current ? { ...current, text } : current))
  }, [])

  // An item edited down to nothing is removed rather than kept as an empty
  // label — the only delete path text items have, since neither the lasso
  // nor the eraser reach into `texts` (see `types.ts`).
  const commitEditingText = useCallback(() => {
    const current = editingText
    if (!current) return
    setEditingText(null)
    const trimmed = current.text.trim()
    if (trimmed === '') {
      if (!current.isNew) {
        commit({ ...inkData, texts: inkData.texts.filter((t) => t.id !== current.id) })
      }
      return
    }
    if (current.isNew) {
      const item: TextItem = {
        id: current.id,
        x: current.x,
        y: current.y,
        text: current.text,
        color: current.color,
        size: current.size,
      }
      commit({
        ...inkData,
        height: grownHeight(inkData.height, [{ x: current.x, y: current.y, pressure: 0 }], autoGrow),
        texts: [...inkData.texts, item],
      })
    } else {
      commit({
        ...inkData,
        texts: inkData.texts.map((t) => (t.id === current.id ? { ...t, text: current.text } : t)),
      })
    }
  }, [editingText, inkData, commit, autoGrow])

  // Escape discards rather than commits: a fresh item was never added, and an
  // edited existing one was never mutated until `commitEditingText` runs, so
  // there is nothing to undo — the pending text simply stops being held.
  const cancelEditingText = useCallback(() => {
    setEditingText(null)
  }, [])

  // Mirrors the note editor's own flush-on-unmount rule (P0-1): a label typed
  // right before switching notes or closing the block must not vanish just
  // because nothing blurred it first. Bypasses `commit`'s history/state
  // plumbing deliberately — the component is gone, only the file write
  // still matters.
  useEffect(() => {
    return () => {
      const current = editingTextRef.current
      if (!current) return
      const trimmed = current.text.trim()
      if (trimmed === '') return
      const base = inkDataRef.current
      const next = current.isNew
        ? { ...base, texts: [...base.texts, { id: current.id, x: current.x, y: current.y, text: current.text, color: current.color, size: current.size }] }
        : { ...base, texts: base.texts.map((t) => (t.id === current.id ? { ...t, text: current.text } : t)) }
      void inkApi.write(svgPath, next)
    }
  }, [svgPath])

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
        fillStroke(ctx, stroke.points, stroke.color, stroke.size, stroke.opacity, stroke.thinning)
      }
      for (const shape of inkData.shapes) {
        drawShapePreview(ctx, shape)
      }
      // The item being typed renders through the overlay textarea instead —
      // drawing it here too would show it twice, once live and once stale.
      for (const item of inkData.texts) {
        if (editingText?.id === item.id) continue
        drawTextItem(ctx, item)
      }
      if (livePoints.length > 1) {
        fillStroke(ctx, livePoints, color, size, opacity, thinning)
      }
      if (liveShape) {
        drawShapePreview(ctx, liveShape)
      }
      if (liveLasso) {
        strokeLasso(ctx, liveLasso, false)
      } else if (lassoPolygon) {
        strokeLasso(ctx, lassoPolygon, true)
      }
      if (ruler) {
        drawRuler(ctx, ruler)
      }
    },
    [inkData, color, size, opacity, zoom, lassoPolygon, ruler, editingText],
  )

  useEffect(() => {
    redrawCanvas([])
  }, [inkData, redrawCanvas])

  // Positioning the straightedge is a hand job, not a pen one — you hold it
  // with a finger and draw against it with the pen, the way you would on paper.
  // The pen can grab it too, but touch is why these are callable from outside.
  const grabRuler = useCallback(
    (x: number, y: number): boolean => {
      if (!ruler) return false
      const kind = grabKind(x, y, ruler)
      if (!kind) return false
      rulerGrab.current = { kind, x, y }
      return true
    },
    [ruler],
  )

  const dragRuler = useCallback((x: number, y: number) => {
    const grab = rulerGrab.current
    if (!grab) return
    if (grab.kind === 'move') {
      const dx = x - grab.x
      const dy = y - grab.y
      rulerGrab.current = { ...grab, x, y }
      setRuler((current) => (current ? moveRuler(current, dx, dy) : current))
      return
    }
    setRuler((current) => (current ? rotateRulerTowards(current, x, y) : current))
  }, [])

  const releaseRuler = useCallback(() => {
    rulerGrab.current = null
  }, [])

  const snappedPoints = useCallback(
    (points: Point[]) => (snapping.current && ruler ? snapStroke(points, ruler) : points),
    [ruler],
  )

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const radius = eraserSize / 2
      setInkData((data) => erase(data, x, y, radius, eraserMode, () => crypto.randomUUID()))
    },
    [eraserSize, eraserMode],
  )

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      capturePointer(canvasRef.current, e.pointerId)
      const activeTool = isEraserTip(e) ? 'eraser' : tool

      // The straightedge is grabbed before any tool gets a look in — landing on
      // it always means "put it somewhere else", whatever is in your hand.
      if (!isEraserTip(e) && grabRuler(e.offsetX / zoom, e.offsetY / zoom)) return

      if (activeTool === 'eraser') {
        eraseSnapshot.current = inkData
        eraseAt(e.offsetX / zoom, e.offsetY / zoom)
        return
      }

      if (activeTool === 'text') {
        // Finalize whatever was open before deciding what this tap means —
        // otherwise a click that lands on a second item while the first is
        // still being typed would hit-test against a page that doesn't yet
        // reflect it.
        commitEditingText()
        const x = e.offsetX / zoom
        const y = e.offsetY / zoom
        const hit = [...inkData.texts].reverse().find((t) => pointInTextItem(t, x, y))
        if (hit) {
          textDragSnapshot.current = inkData
          textDragFrom.current = { id: hit.id, x, y, moved: false }
        } else {
          startNewText(x, y)
        }
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
      const start = { x: e.offsetX / zoom, y: e.offsetY / zoom, pressure: e.pressure }
      // Judged once, at the start: a stroke that drifted on and off the edge
      // partway through would be worse than one that never snapped at all.
      snapping.current = ruler !== null && shouldSnap(start, ruler)
      currentStroke.current = [start]
    },
    [
      tool, inkData, eraseAt, zoom, lassoPolygon, selection, clearSelection, ruler, grabRuler,
      commitEditingText, startNewText,
    ],
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      const activeTool = isEraserTip(e) ? 'eraser' : tool

      if (rulerGrab.current) {
        dragRuler(e.offsetX / zoom, e.offsetY / zoom)
        return
      }

      if (activeTool === 'eraser') {
        // Only while the tip is actually down — hovering must not erase.
        if (eraseSnapshot.current) eraseAt(e.offsetX / zoom, e.offsetY / zoom)
        return
      }

      if (activeTool === 'text') {
        const from = textDragFrom.current
        if (!from) return
        const x = e.offsetX / zoom
        const y = e.offsetY / zoom
        const dx = x - from.x
        const dy = y - from.y
        if (!from.moved && Math.hypot(dx, dy) < TEXT_DRAG_THRESHOLD) return
        from.moved = true
        textDragFrom.current = { ...from, x, y }
        setInkData((data) => ({
          ...data,
          texts: data.texts.map((t) => (t.id === from.id ? translateTextItem(t, dx, dy) : t)),
        }))
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
      redrawCanvas(snappedPoints(currentStroke.current))
    },
    [tool, size, color, eraseAt, redrawCanvas, zoom, selection, snappedPoints, dragRuler],
  )

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      releasePointer(canvasRef.current, e.pointerId)

      // Where the ruler ends up is not an edit to the note, so it costs no
      // history entry and no write.
      if (rulerGrab.current) {
        releaseRuler()
        return
      }

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

      // A drag is one history entry and one write; a tap that never crossed
      // the move threshold opens the editor instead — the click/drag split a
      // pointerdown-time hit-test alone can't make, since nothing has moved
      // yet when the pen first touches down.
      const textFrom = textDragFrom.current
      if (textFrom) {
        textDragFrom.current = null
        const snapshot = textDragSnapshot.current
        textDragSnapshot.current = null
        if (textFrom.moved && snapshot) {
          setHistory((past) => [...past, snapshot])
          setFuture([])
          const item = inkData.texts.find((t) => t.id === textFrom.id)
          const grown = {
            ...inkData,
            height: item
              ? grownHeight(inkData.height, [{ x: item.x, y: item.y, pressure: 0 }], autoGrow)
              : inkData.height,
          }
          setInkData(grown)
          void inkApi.write(svgPath, grown)
        } else {
          const item = inkData.texts.find((t) => t.id === textFrom.id)
          if (item) startEditText(item)
        }
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
        points: snappedPoints(currentStroke.current),
        color,
        size,
        opacity,
        thinning,
      }
      currentStroke.current = []
      snapping.current = false
      commit({
        ...inkData,
        height: grownHeight(inkData.height, stroke.points, autoGrow),
        strokes: [...inkData.strokes, stroke],
      })
    },
    [
      tool, inkData, color, size, opacity, commit, svgPath, zoom, autoGrow, selection,
      snappedPoints, releaseRuler, startEditText,
    ],
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
    eraserMode,
    setEraserMode,
    ruler,
    toggleRuler,
    grabRuler,
    dragRuler,
    releaseRuler,
    inkData,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
    editingText,
    updateEditingText,
    commitEditingText,
    cancelEditingText,
  }
}
