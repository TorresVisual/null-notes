import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
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
import { pointInTextItem, translateTextItem, boundsOfTextItem } from './textBounds'
import { MIN_EXTENT, extentOf, boundsOfPoints, type Bounds } from './bounds'
import { isVisible, screenToWorld } from './camera'
import type { Camera, Viewport } from './camera'
import { straightLineEnds } from './straighten'
import { paintOrder } from './paintOrder'
import { strokeOptions } from './strokeOptions'
import {
  EMPTY_SELECTION,
  isSelectionEmpty,
  pointInPolygon,
  selectionIn,
  translatePolygon,
  translateSelection,
  deleteSelection as removeSelection,
} from './lasso'
import type { LassoPoint, Selection } from './lasso'
import { useInkStore, activePenOf } from '../store/ink'
import type { InkBackdrop } from './InkEditorOverlay'
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
  camera: Camera
  viewport: Viewport
  backdrop?: InkBackdrop
  onSaved?: () => void
  onLoaded?: (data: InkData) => void
}

const EMPTY_INK: InkData = { originX: 0, originY: 0, width: MIN_EXTENT, height: MIN_EXTENT, strokes: [], shapes: [], texts: [] }

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

// Touch pans and pinches, so it never draws; pen and mouse do.
export function isDrawingPointer(e: { pointerType: string }): boolean {
  return e.pointerType === 'pen' || e.pointerType === 'mouse'
}

export function toInk(
  e: { clientX: number; clientY: number },
  camera: Camera,
  rect: { left: number; top: number },
): { x: number; y: number } {
  return screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top)
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
  thinning?: number,
): void {
  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.pressure]),
    strokeOptions({ size, opacity, thinning }),
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

// Bounds are cached per object: committed ink is replaced, never mutated, so a
// stroke's box is computed once however many frames repaint it.
const itemBounds = new WeakMap<object, Bounds>()

function paddedBounds(points: { x: number; y: number }[], by: number): Bounds {
  const b = boundsOfPoints(points)
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by }
}

function strokeBounds(stroke: Stroke): Bounds {
  let bounds = itemBounds.get(stroke)
  if (!bounds) {
    bounds = paddedBounds(stroke.points, stroke.size)
    itemBounds.set(stroke, bounds)
  }
  return bounds
}

function shapeBounds(shape: Shape): Bounds {
  let bounds = itemBounds.get(shape)
  if (!bounds) {
    bounds = paddedBounds(
      [
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
      ],
      shape.size,
    )
    itemBounds.set(shape, bounds)
  }
  return bounds
}

function paintCommitted(
  ctx: CanvasRenderingContext2D,
  data: InkData,
  editingTextId: string | null,
  camera: Camera,
  viewport: Viewport,
): void {
  for (const stroke of paintOrder(data.strokes)) {
    if (!isVisible(camera, viewport, strokeBounds(stroke))) continue
    fillStroke(ctx, stroke.points, stroke.color, stroke.size, stroke.opacity, stroke.thinning)
  }
  for (const shape of data.shapes) {
    if (!isVisible(camera, viewport, shapeBounds(shape))) continue
    drawShapePreview(ctx, shape)
  }
  // The item being typed renders through the overlay textarea instead —
  // drawing it here too would show it twice, once live and once stale.
  for (const item of data.texts) {
    if (editingTextId === item.id) continue
    if (!isVisible(camera, viewport, boundsOfTextItem(item))) continue
    drawTextItem(ctx, item)
  }
}

// Must match nothing but itself now: the grid is drawn from the camera, so it
// is a world-space ruling that scales with zoom and is never saved.
const GRID_SIZE = 24
const MIN_GRID_PX = 4
const FALLBACK_GRID_COLOR = 'rgba(128, 128, 128, 0.18)'

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, viewport: Viewport, color: string): void {
  if (GRID_SIZE * camera.scale < MIN_GRID_PX) return
  ctx.beginPath()
  ctx.lineWidth = 1
  ctx.strokeStyle = color
  for (let wx = Math.ceil(camera.x / GRID_SIZE) * GRID_SIZE; ; wx += GRID_SIZE) {
    const sx = Math.round((wx - camera.x) * camera.scale) + 0.5
    if (sx > viewport.width) break
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, viewport.height)
  }
  for (let wy = Math.ceil(camera.y / GRID_SIZE) * GRID_SIZE; ; wy += GRID_SIZE) {
    const sy = Math.round((wy - camera.y) * camera.scale) + 0.5
    if (sy > viewport.height) break
    ctx.moveTo(0, sy)
    ctx.lineTo(viewport.width, sy)
  }
  ctx.stroke()
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
  { camera, viewport, backdrop, onSaved, onLoaded }: InkOptions,
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
  const [inkData, setInkData] = useState<InkData>(
    backdrop ? { ...EMPTY_INK, width: backdrop.width, height: backdrop.height } : EMPTY_INK,
  )
  const [backdropImage, setBackdropImage] = useState<HTMLImageElement | null>(null)
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

  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    onSavedRef.current = onSaved
  }, [onSaved])
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    onLoadedRef.current = onLoaded
  }, [onLoaded])

  // Pointer handlers read the camera through a ref so they are not re-bound on
  // every frame of a pan or zoom.
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const backdropUrl = backdrop?.dataUrl
  useEffect(() => {
    if (!backdropUrl) {
      setBackdropImage(null)
      return
    }
    const image = new Image()
    image.onload = () => setBackdropImage(image)
    image.src = backdropUrl
    return () => {
      image.onload = null
    }
  }, [backdropUrl])

  const toWorld = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    return toInk(e, cameraRef.current, rect)
  }, [])

  // Writes are fire-and-forget, so a caller re-reading the sidecar on close could
  // beat the last stroke to disk. `onSaved` fires from the resolved write instead.
  // The declared extent follows the ink, except over a page backdrop where it
  // stays the page rectangle so the preview keeps lining up with the image.
  // Keyed on the page's size, not the backdrop object, so the identity of this
  // callback (and the unmount flush that depends on it) does not churn.
  const pageWidth = backdrop?.width
  const pageHeight = backdrop?.height
  const save = useCallback(
    (data: InkData) => {
      const sized =
        pageWidth !== undefined && pageHeight !== undefined
          ? { ...data, originX: 0, originY: 0, width: pageWidth, height: pageHeight }
          : extentOf(data)
      void inkApi.write(svgPath, sized).then(() => onSavedRef.current?.())
    },
    [svgPath, pageWidth, pageHeight],
  )

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

  // The ruler arrives lying across the middle of what you are looking at.
  const toggleRuler = useCallback(() => {
    setRuler((current) => {
      if (current) return null
      const { width, height } = viewportRef.current
      return centredRuler(screenToWorld(cameraRef.current, width / 2, height / 2))
    })
  }, [])

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
      onLoadedRef.current?.(data ?? EMPTY_INK)
    })
  }, [svgPath])

  const commit = useCallback(
    (next: InkData) => {
      setHistory((past) => [...past, inkData])
      setFuture([])
      setInkData(next)
      save(next)
    },
    [inkData, save],
  )

  const undo = useCallback(() => {
    const previous = history[history.length - 1]
    if (!previous) return
    setHistory(history.slice(0, -1))
    setFuture([...future, inkData])
    setInkData(previous)
    save(previous)
  }, [history, future, inkData, save])

  const redo = useCallback(() => {
    const next = future[future.length - 1]
    if (!next) return
    setFuture(future.slice(0, -1))
    setHistory([...history, inkData])
    setInkData(next)
    save(next)
  }, [history, future, inkData, save])

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
      commit({ ...inkData, texts: [...inkData.texts, item] })
    } else {
      commit({
        ...inkData,
        texts: inkData.texts.map((t) => (t.id === current.id ? { ...t, text: current.text } : t)),
      })
    }
  }, [editingText, inkData, commit])

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
      save(next)
    }
  }, [save])

  const redrawCanvas = useCallback(
    (livePoints: Point[], liveShape?: PreviewShape | null, liveLasso?: LassoPoint[] | null) => {
      const canvas = canvasRef.current
      if (!canvas) return

      // The canvas is exactly the window, in real device pixels, and only a
      // window resize changes that: zooming moves the camera, never the buffer.
      const dpr = window.devicePixelRatio || 1
      const pixelWidth = Math.round(viewport.width * dpr)
      const pixelHeight = Math.round(viewport.height * dpr)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewport.width, viewport.height)
      const grid = getComputedStyle(canvas).getPropertyValue('--ink-grid').trim() || FALLBACK_GRID_COLOR
      drawGrid(ctx, camera, viewport, grid)

      const scale = dpr * camera.scale
      ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale)
      if (backdrop && backdropImage) {
        ctx.drawImage(backdropImage, 0, 0, backdrop.width, backdrop.height)
      }
      paintCommitted(ctx, inkData, editingText?.id ?? null, camera, viewport)
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
    [inkData, color, size, opacity, thinning, camera, viewport, backdrop, backdropImage, lassoPolygon, ruler, editingText],
  )

  useEffect(() => {
    redrawCanvas([])
  }, [inkData, redrawCanvas])

  // Pen digitisers report faster than displays refresh, so painting per event
  // paints frames nobody sees. The latest preview wins; at most one frame is
  // ever queued.
  const frame = useRef<number | null>(null)
  const pendingLive = useRef<Parameters<typeof redrawCanvas>>([[]])
  const redrawRef = useRef(redrawCanvas)
  useEffect(() => {
    redrawRef.current = redrawCanvas
  }, [redrawCanvas])

  const scheduleRedraw = useCallback((...live: Parameters<typeof redrawCanvas>) => {
    pendingLive.current = live
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      redrawRef.current(...pendingLive.current)
    })
  }, [])

  const cancelRedraw = useCallback(() => {
    if (frame.current === null) return
    cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

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
      if (!isDrawingPointer(e) || (e.pointerType === 'mouse' && e.button !== 0)) return
      capturePointer(canvasRef.current, e.pointerId)
      const activeTool = isEraserTip(e) ? 'eraser' : tool
      const at = toWorld(e)

      // The straightedge is grabbed before any tool gets a look in — landing on
      // it always means "put it somewhere else", whatever is in your hand.
      if (!isEraserTip(e) && grabRuler(at.x, at.y)) return

      if (activeTool === 'eraser') {
        eraseSnapshot.current = inkData
        eraseAt(at.x, at.y)
        return
      }

      if (activeTool === 'text') {
        // Finalize whatever was open before deciding what this tap means —
        // otherwise a click that lands on a second item while the first is
        // still being typed would hit-test against a page that doesn't yet
        // reflect it.
        commitEditingText()
        const { x, y } = at
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
        const { x, y } = at

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
        shapeStart.current = { x: at.x, y: at.y }
        return
      }
      const start = { x: at.x, y: at.y, pressure: e.pressure }
      // Judged once, at the start: a stroke that drifted on and off the edge
      // partway through would be worse than one that never snapped at all.
      snapping.current = ruler !== null && shouldSnap(start, ruler)
      currentStroke.current = [start]
    },
    [
      tool, inkData, eraseAt, toWorld, lassoPolygon, selection, clearSelection, ruler, grabRuler,
      commitEditingText, startNewText,
    ],
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDrawingPointer(e)) return
      const activeTool = isEraserTip(e) ? 'eraser' : tool
      const at = toWorld(e)

      if (rulerGrab.current) {
        dragRuler(at.x, at.y)
        return
      }

      if (activeTool === 'eraser') {
        // Only while the tip is actually down — hovering must not erase.
        if (eraseSnapshot.current) eraseAt(at.x, at.y)
        return
      }

      if (activeTool === 'text') {
        const from = textDragFrom.current
        if (!from) return
        const { x, y } = at
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
        const { x, y } = at

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
        scheduleRedraw([], null, lassoPath.current)
        return
      }

      if (isShapeTool(activeTool)) {
        if (!shapeStart.current) return
        scheduleRedraw([], {
          kind: activeTool as Shape['kind'],
          x1: shapeStart.current.x,
          y1: shapeStart.current.y,
          x2: at.x,
          y2: at.y,
          color,
          size,
        })
        return
      }

      if (currentStroke.current.length === 0) return
      const events = e.getCoalescedEvents?.() ?? [e]
      for (const ce of events) {
        currentStroke.current.push({ ...toWorld(ce), pressure: ce.pressure })
      }
      scheduleRedraw(snappedPoints(currentStroke.current))
    },
    [tool, size, color, eraseAt, scheduleRedraw, toWorld, selection, snappedPoints, dragRuler],
  )

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!isDrawingPointer(e)) return
      releasePointer(canvasRef.current, e.pointerId)
      cancelRedraw()

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
          save(inkData)
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
          save(inkData)
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
          save(inkData)
        }
        return
      }

      if (shapeStart.current) {
        const end = toWorld(e)
        const shape: Shape = {
          id: crypto.randomUUID(),
          kind: tool as Shape['kind'],
          x1: shapeStart.current.x,
          y1: shapeStart.current.y,
          x2: end.x,
          y2: end.y,
          color,
          size,
        }
        shapeStart.current = null
        currentStroke.current = []
        commit({ ...inkData, shapes: [...inkData.shapes, shape] })
        return
      }

      if (currentStroke.current.length < 2) {
        currentStroke.current = []
        return
      }

      const points = snappedPoints(currentStroke.current)
      currentStroke.current = []
      snapping.current = false

      // A completed pen stroke that is nearly straight becomes an actual
      // line, the same object a user would get from the line tool — matches
      // OneNote's auto-straighten rather than leaving a wobbly freehand line
      // that merely looks straight.
      const straight = straightLineEnds(points)
      if (straight) {
        const shape: Shape = { id: crypto.randomUUID(), kind: 'line', ...straight, color, size }
        commit({ ...inkData, shapes: [...inkData.shapes, shape] })
        return
      }

      const stroke: Stroke = { id: crypto.randomUUID(), points, color, size, opacity, thinning }
      commit({ ...inkData, strokes: [...inkData.strokes, stroke] })
    },
    [
      tool, inkData, color, size, opacity, commit, save, toWorld, selection,
      snappedPoints, releaseRuler, startEditText, cancelRedraw,
    ],
  )

  const deleteSelected = useCallback(() => {
    if (isSelectionEmpty(selection)) return
    commit(removeSelection(inkData, selection))
    clearSelection()
  }, [selection, inkData, commit, clearSelection])

  useEffect(() => {
    if (isSelectionEmpty(selection)) return
    // Every mounted canvas hears window keydown; only the one the user last
    // pointed at may delete, or a hidden canvas's selection goes with it.
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (useInkStore.getState().activeCanvasId !== svgPath) return
      e.preventDefault()
      deleteSelected()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selection, deleteSelected, svgPath])

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
