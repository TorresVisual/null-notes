import { useRef, useState, useEffect, useCallback } from 'react'
import { getStroke } from 'perfect-freehand'
import { inkApi } from '../lib/ink'
import type { InkData, Stroke, Shape, Tool, Point } from './types'

export function useInkCanvas(svgPath: string, width: number, height: number) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#000000')
  const [size, setSize] = useState(4)
  const [inkData, setInkData] = useState<InkData>({ width, height, strokes: [], shapes: [] })

  const history = useRef<InkData[]>([])
  const future = useRef<InkData[]>([])
  const currentStroke = useRef<Point[]>([])
  const shapeStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    inkApi.read(svgPath).then((data) => {
      if (data) setInkData(data)
    })
  }, [svgPath])

  const commit = useCallback(
    (next: InkData) => {
      history.current.push(inkData)
      future.current = []
      setInkData(next)
      void inkApi.write(svgPath, next)
    },
    [inkData, svgPath],
  )

  const undo = useCallback(() => {
    const prev = history.current.pop()
    if (!prev) return
    future.current.push(inkData)
    setInkData(prev)
    void inkApi.write(svgPath, prev)
  }, [inkData, svgPath])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    history.current.push(inkData)
    setInkData(next)
    void inkApi.write(svgPath, next)
  }, [inkData, svgPath])

  const redrawCanvas = useCallback(
    (livePoints: Point[]) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (const stroke of inkData.strokes) {
        const pts = stroke.points.map((p) => [p.x, p.y, p.pressure])
        const outline = getStroke(pts, { size: stroke.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 })
        if (outline.length === 0) continue
        ctx.beginPath()
        ctx.fillStyle = stroke.color
        const first = outline[0]
        if (!first) continue
        ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
        for (let i = 1; i < outline.length; i++) {
          const p = outline[i]
          if (p) ctx.lineTo(p[0] ?? 0, p[1] ?? 0)
        }
        ctx.closePath()
        ctx.fill()
      }

      if (livePoints.length > 1) {
        const pts = livePoints.map((p) => [p.x, p.y, p.pressure])
        const outline = getStroke(pts, { size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 })
        if (outline.length > 0) {
          const first = outline[0]
          if (!first) return
          ctx.beginPath()
          ctx.fillStyle = color
          ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
          for (let i = 1; i < outline.length; i++) {
            const p = outline[i]
            if (p) ctx.lineTo(p[0] ?? 0, p[1] ?? 0)
          }
          ctx.closePath()
          ctx.fill()
        }
      }
    },
    [inkData, color, size],
  )

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      const activeTool = e.button === 5 ? 'eraser' : tool
      if (activeTool === 'eraser') return
      if (['line', 'circle', 'rect', 'arrow'].includes(activeTool)) {
        shapeStart.current = { x: e.offsetX, y: e.offsetY }
        return
      }
      currentStroke.current = [{ x: e.offsetX, y: e.offsetY, pressure: e.pressure }]
    },
    [tool],
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      const activeTool = e.button === 5 ? 'eraser' : tool

      if (activeTool === 'eraser') {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const surviving = inkData.strokes.filter((s) =>
          s.points.every((p) => Math.hypot(p.x - x, p.y - y) > size * 3),
        )
        if (surviving.length !== inkData.strokes.length) {
          commit({ ...inkData, strokes: surviving })
        }
        return
      }

      const events = e.getCoalescedEvents?.() ?? [e]
      for (const ce of events) {
        currentStroke.current.push({ x: ce.offsetX, y: ce.offsetY, pressure: ce.pressure })
      }
      redrawCanvas(currentStroke.current)
    },
    [tool, inkData, size, commit, redrawCanvas],
  )

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      const activeTool = e.button === 5 ? 'eraser' : tool

      if (['line', 'circle', 'rect', 'arrow'].includes(activeTool) && shapeStart.current) {
        const shape: Shape = {
          id: crypto.randomUUID(),
          kind: activeTool as Shape['kind'],
          x1: shapeStart.current.x,
          y1: shapeStart.current.y,
          x2: e.offsetX,
          y2: e.offsetY,
          color,
          size,
        }
        shapeStart.current = null
        commit({ ...inkData, shapes: [...inkData.shapes, shape] })
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
      commit({ ...inkData, strokes: [...inkData.strokes, stroke] })
    },
    [tool, inkData, color, size, commit],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
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
    canUndo: history.current.length > 0,
    canRedo: future.current.length > 0,
  }
}
