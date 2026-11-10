import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { fitCamera, panBy, screenToWorld, zoomAbout } from '../ink/camera'
import type { Camera, Viewport } from '../ink/camera'
import { wheelZoom } from '../ink/zoom'
import type { Bounds } from '../ink/bounds'

const LINE_HEIGHT = 16
const INITIAL_CAMERA: Camera = { x: 0, y: 0, scale: 1 }
const NO_VIEWPORT: Viewport = { width: 0, height: 0 }

// A mouse wheel reports lines (Firefox) or pages, not pixels; left raw, one
// notch would pan a single pixel.
function wheelPixels(delta: number, mode: number, pageSize: number): number {
  if (mode === 1) return delta * LINE_HEIGHT
  if (mode === 2) return delta * pageSize
  return delta
}

function isTextTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
}

// `fitTo` is null until the drawing has loaded; the camera fits the ink once,
// when both it and a measured viewport exist, and is never refitted after.
export function useCamera(containerRef: RefObject<HTMLElement | null>, fitTo: Bounds | null) {
  const cameraRef = useRef<Camera>(INITIAL_CAMERA)
  const viewportRef = useRef<Viewport>(NO_VIEWPORT)
  const fitted = useRef(false)
  const frame = useRef<number | null>(null)
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA)
  const [viewport, setViewport] = useState<Viewport>(NO_VIEWPORT)

  // The ref is the truth, so several events landing before a frame still
  // compose; React only sees it once per animation frame.
  const updateCamera = useCallback((update: (current: Camera) => Camera) => {
    cameraRef.current = update(cameraRef.current)
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setCamera(cameraRef.current)
    })
  }, [])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      return screenToWorld(cameraRef.current, clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0))
    },
    [containerRef],
  )

  const zoomToward = useCallback(
    (scale: number) => {
      const { width, height } = viewportRef.current
      updateCamera((current) => zoomAbout(current, width / 2, height / 2, scale))
    },
    [updateCamera],
  )

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    function measure() {
      const rect = el?.getBoundingClientRect()
      if (!rect) return
      const previous = viewportRef.current
      const next = { width: rect.width, height: rect.height }
      if (next.width === previous.width && next.height === previous.height) return
      viewportRef.current = next
      if (fitted.current) {
        const centre = screenToWorld(cameraRef.current, previous.width / 2, previous.height / 2)
        const scale = cameraRef.current.scale
        updateCamera(() => ({ x: centre.x - next.width / (2 * scale), y: centre.y - next.height / (2 * scale), scale }))
        // Committed with the new viewport, not a frame later, so a resize never
        // paints one frame of the old camera over the new size.
        setCamera(cameraRef.current)
      }
      setViewport(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef, updateCamera])

  useEffect(() => {
    if (fitted.current || !fitTo || viewport.width <= 0 || viewport.height <= 0) return
    fitted.current = true
    updateCamera(() => fitCamera(fitTo, viewport, 1))
  }, [fitTo, viewport, updateCamera])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const target = el

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = target.getBoundingClientRect()
      const dx = wheelPixels(e.deltaX, e.deltaMode, rect.width)
      const dy = wheelPixels(e.deltaY, e.deltaMode, rect.height)
      if (e.ctrlKey) {
        updateCamera((current) =>
          zoomAbout(current, e.clientX - rect.left, e.clientY - rect.top, wheelZoom(current.scale, dy)),
        )
      } else {
        updateCamera((current) => panBy(current, -dx, -dy))
      }
    }

    let spaceHeld = false
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !isTextTarget(e.target)) spaceHeld = true
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') spaceHeld = false
    }
    function onBlur() {
      spaceHeld = false
    }

    // Captured so a pan press never reaches the canvas underneath, which would
    // otherwise start a stroke at the same time.
    let panning: { id: number; x: number; y: number } | null = null
    function onPointerDown(e: PointerEvent) {
      if (e.button !== 1 && !(e.button === 0 && spaceHeld)) return
      e.preventDefault()
      e.stopPropagation()
      panning = { id: e.pointerId, x: e.clientX, y: e.clientY }
    }
    function onPointerMove(e: PointerEvent) {
      if (!panning || e.pointerId !== panning.id) return
      const dx = e.clientX - panning.x
      const dy = e.clientY - panning.y
      panning = { ...panning, x: e.clientX, y: e.clientY }
      updateCamera((current) => panBy(current, dx, dy))
    }
    function onPointerEnd(e: PointerEvent) {
      if (panning && e.pointerId === panning.id) panning = null
    }

    target.addEventListener('wheel', onWheel, { passive: false })
    target.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      target.removeEventListener('wheel', onWheel)
      target.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [containerRef, updateCamera])

  return { camera, viewport, zoomToward, toWorld, updateCamera }
}
