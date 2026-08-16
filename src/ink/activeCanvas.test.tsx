import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { InkCanvas } from './InkCanvas'
import { useInkStore } from '../store/ink'

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
  },
}))

beforeEach(() => useInkStore.setState({ activeCanvas: null, activeCanvasId: null }))
afterEach(cleanup)

function pointerDownOn(container: HTMLElement) {
  const canvas = container.querySelector('canvas')!
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
}

describe('registering the canvas being drawn in', () => {
  it('registers on pointerdown', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} />)

    pointerDownOn(container)

    await waitFor(() => expect(useInkStore.getState().activeCanvas).not.toBeNull())
    expect(useInkStore.getState().activeCanvasId).toBe('/ws/N.ink/a.svg')
  })

  it('clears when it unmounts while active', async () => {
    const { container, unmount } = render(
      <InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} />,
    )
    pointerDownOn(container)
    await waitFor(() => expect(useInkStore.getState().activeCanvas).not.toBeNull())

    unmount()

    expect(useInkStore.getState().activeCanvas).toBeNull()
  })

  // The scenario the original ref-based design got wrong: two canvases
  // mounted at once — one per exercise solution is now the normal case —
  // and the one that lost the slot must not be able to reclaim or clear it
  // later, whether by its own state changing or by unmounting.
  it('a second canvas becoming active is not later overwritten by the first', async () => {
    const a = render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} />)
    const b = render(<InkCanvas svgPath="/ws/N.ink/b.svg" width={700} height={400} />)

    pointerDownOn(a.container)
    await waitFor(() => expect(useInkStore.getState().activeCanvasId).toBe('/ws/N.ink/a.svg'))

    pointerDownOn(b.container)
    await waitFor(() => expect(useInkStore.getState().activeCanvasId).toBe('/ws/N.ink/b.svg'))

    a.unmount()

    expect(useInkStore.getState().activeCanvasId).toBe('/ws/N.ink/b.svg')
    expect(useInkStore.getState().activeCanvas).not.toBeNull()
  })
})
