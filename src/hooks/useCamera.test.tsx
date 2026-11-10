import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { useRef } from 'react'
import { useCamera } from './useCamera'
import { EMPTY_BOUNDS } from '../ink/bounds'
import type { Bounds } from '../ink/bounds'

type CameraApi = ReturnType<typeof useCamera>

let api: CameraApi
let size = { width: 800, height: 600 }
const observers: Array<() => void> = []

class CapturingResizeObserver {
  constructor(callback: () => void) {
    observers.push(callback)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Harness({ fitTo }: { fitTo: Bounds | null }) {
  const ref = useRef<HTMLDivElement>(null)
  api = useCamera(ref, fitTo)
  return <div ref={ref} data-testid="surface" />
}

beforeEach(() => {
  size = { width: 800, height: 600 }
  observers.length = 0
  vi.stubGlobal('ResizeObserver', CapturingResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        left: 0,
        top: 0,
        right: size.width,
        bottom: size.height,
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        toJSON: () => ({}),
      }) as DOMRect,
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mount(fitTo: Bounds | null = EMPTY_BOUNDS) {
  const utils = render(<Harness fitTo={fitTo} />)
  const surface = utils.getByTestId('surface')
  await waitFor(() => expect(api.viewport.width).toBe(800))
  await waitFor(() => expect(api.camera).toEqual({ x: -400, y: -300, scale: 1 }))
  return { ...utils, surface }
}

describe('useCamera', () => {
  it('fits the ink once the viewport and the data are both known', async () => {
    const { rerender } = render(<Harness fitTo={null} />)
    await waitFor(() => expect(api.viewport.width).toBe(800))
    expect(api.camera).toEqual({ x: 0, y: 0, scale: 1 })

    rerender(<Harness fitTo={EMPTY_BOUNDS} />)

    await waitFor(() => expect(api.camera).toEqual({ x: -400, y: -300, scale: 1 }))
    rerender(<Harness fitTo={{ minX: 0, minY: 0, maxX: 5000, maxY: 5000 }} />)
    expect(api.camera).toEqual({ x: -400, y: -300, scale: 1 })
  })

  it('zooms about the cursor on Ctrl+wheel', async () => {
    const { surface } = await mount()
    const before = api.toWorld(600, 100)

    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -200, clientX: 600, clientY: 100 })

    await waitFor(() => expect(api.camera.scale).toBeGreaterThan(1))
    const after = api.toWorld(600, 100)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('pans on a plain wheel in pixel mode', async () => {
    const { surface } = await mount()
    const start = api.camera

    fireEvent.wheel(surface, { deltaY: 100, deltaX: 0 })

    await waitFor(() => expect(api.camera.y).toBe(start.y + 100))
    expect(api.camera.x).toBe(start.x)
    expect(api.camera.scale).toBe(1)
  })

  it('treats wheel lines as 16px, not one pixel per notch', async () => {
    const { surface } = await mount()
    const start = api.camera

    fireEvent.wheel(surface, { deltaY: 3, deltaMode: 1 })

    await waitFor(() => expect(api.camera.y).toBe(start.y + 48))
  })

  it('treats a wheel page as a viewport height', async () => {
    const { surface } = await mount()
    const start = api.camera

    fireEvent.wheel(surface, { deltaY: 1, deltaMode: 2 })

    await waitFor(() => expect(api.camera.y).toBe(start.y + 600))
  })

  it('pans on a middle-button drag', async () => {
    const { surface } = await mount()
    const start = api.camera

    fireEvent.pointerDown(surface, { button: 1, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 130, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 130, clientY: 100, pointerId: 1 })

    await waitFor(() => expect(api.camera.x).toBe(start.x - 30))
    expect(api.camera.y).toBe(start.y)
  })

  it('pans on a left drag only while Space is held', async () => {
    const { surface } = await mount()
    const start = api.camera

    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.pointerDown(surface, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 50, clientY: 70, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 50, clientY: 70, pointerId: 1 })
    await waitFor(() => expect(api.camera.y).toBe(start.y - 20))

    fireEvent.keyUp(window, { code: 'Space' })
    fireEvent.pointerDown(surface, { button: 0, clientX: 50, clientY: 50, pointerId: 2 })
    fireEvent.pointerMove(window, { clientX: 50, clientY: 90, pointerId: 2 })
    fireEvent.pointerUp(window, { clientX: 50, clientY: 90, pointerId: 2 })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(api.camera.y).toBe(start.y - 20)
  })

  it('does not treat Space typed into a text field as a pan', async () => {
    const { surface } = await mount()
    const start = api.camera
    const field = document.createElement('textarea')
    document.body.appendChild(field)

    fireEvent.keyDown(field, { code: 'Space' })
    fireEvent.pointerDown(surface, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 50, clientY: 90, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 50, clientY: 90, pointerId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(api.camera).toEqual(start)
    field.remove()
  })

  it('keeps the world point at the viewport centre fixed across a resize', async () => {
    const { surface } = await mount()
    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -300, clientX: 200, clientY: 150 })
    await waitFor(() => expect(api.camera.scale).toBeGreaterThan(1))
    const centreBefore = api.toWorld(400, 300)

    size = { width: 1000, height: 600 }
    act(() => observers.forEach((notify) => notify()))

    await waitFor(() => expect(api.viewport.width).toBe(1000))
    const { camera } = api
    expect(camera.x + 1000 / (2 * camera.scale)).toBeCloseTo(centreBefore.x, 6)
    expect(camera.y + 600 / (2 * camera.scale)).toBeCloseTo(centreBefore.y, 6)
  })

  it('zooms about the viewport centre for the keyboard', async () => {
    await mount()
    const centre = api.toWorld(400, 300)

    act(() => api.zoomToward(2))

    await waitFor(() => expect(api.camera.scale).toBe(2))
    const after = api.toWorld(400, 300)
    expect(after.x).toBeCloseTo(centre.x, 6)
    expect(after.y).toBeCloseTo(centre.y, 6)
  })
})
