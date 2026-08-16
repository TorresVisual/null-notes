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

beforeEach(() => useInkStore.getState().clearActiveCanvas())
afterEach(cleanup)

describe('registering the canvas being drawn in', () => {
  it('registers on pointerdown', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} />)

    const canvas = container.querySelector('canvas')!
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })

    await waitFor(() => expect(useInkStore.getState().activeCanvas).not.toBeNull())
  })

  it('clears when it unmounts while active', async () => {
    const { container, unmount } = render(
      <InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} />,
    )
    fireEvent.pointerDown(container.querySelector('canvas')!, { clientX: 10, clientY: 10, pointerId: 1 })
    await waitFor(() => expect(useInkStore.getState().activeCanvas).not.toBeNull())

    unmount()

    expect(useInkStore.getState().activeCanvas).toBeNull()
  })
})
