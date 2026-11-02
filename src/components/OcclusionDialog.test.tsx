import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { OcclusionDialog } from './OcclusionDialog'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { assets: { read: vi.fn() } },
}))

const BOX = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 }

function pointer(type: string, clientX: number, clientY: number): Event {
  return new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true })
}

function drag(surface: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent(surface, pointer('pointerdown', ...from))
  fireEvent(surface, pointer('pointermove', ...to))
  fireEvent(surface, pointer('pointerup', ...to))
}

beforeEach(() => {
  vi.mocked(api.assets.read).mockResolvedValue('YmFzZTY0')
  HTMLElement.prototype.setPointerCapture = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ ...BOX, toJSON: () => BOX })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function mount(onConfirm = vi.fn()) {
  render(<OcclusionDialog notePath="/ws/a.md" src="a.assets/p.png" onConfirm={onConfirm} onClose={vi.fn()} />)
  return { onConfirm, surface: await screen.findByTestId('occlusion-surface') }
}

describe('OcclusionDialog', () => {
  it('collects several drawn regions as fractions of the image and confirms them together', async () => {
    const { onConfirm, surface } = await mount()
    expect(screen.getByRole('button', { name: 'Create 0 cards' })).toBeDisabled()

    drag(surface, [20, 10], [100, 30])
    drag(surface, [150, 50], [190, 90])

    await screen.findByRole('button', { name: 'Create 2 cards' })
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 cards' }))
    expect(onConfirm).toHaveBeenCalledWith([
      { x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
      { x: 0.75, y: 0.5, w: 0.2, h: 0.4 },
    ])
  })

  it('ignores a click that never became a region', async () => {
    const { surface } = await mount()
    drag(surface, [40, 40], [40, 40])
    expect(screen.getByRole('button', { name: 'Create 0 cards' })).toBeDisabled()
  })

  it('removes a region the user changed their mind about', async () => {
    const { onConfirm, surface } = await mount()
    drag(surface, [20, 10], [100, 30])
    drag(surface, [150, 50], [190, 90])

    fireEvent.click(await screen.findByRole('button', { name: 'Remove region 1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create 1 card' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm).toHaveBeenCalledWith([{ x: 0.75, y: 0.5, w: 0.2, h: 0.4 }])
  })
})
