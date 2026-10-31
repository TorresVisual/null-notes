import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PassLegend } from './PassLegend'

afterEach(cleanup)

function renderLegend(hidden: number[] = []) {
  const handlers = { onToggle: vi.fn(), onShowOnlyLatest: vi.fn(), onJump: vi.fn() }
  render(<PassLegend passes={[1, 2, 3]} hidden={new Set(hidden)} {...handlers} />)
  return handlers
}

describe('PassLegend', () => {
  it('toggles a pass from its eye button', async () => {
    const { onToggle } = renderLegend()
    await userEvent.click(screen.getByRole('button', { name: 'Hide pass 2' }))
    expect(onToggle).toHaveBeenCalledWith(2)
  })

  it('offers to show a hidden pass again', () => {
    renderLegend([2])
    expect(screen.getByRole('button', { name: 'Show pass 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide pass 1' })).toBeTruthy()
  })

  it('jumps to a pass when its label is clicked', async () => {
    const { onJump } = renderLegend()
    await userEvent.click(screen.getByRole('button', { name: 'Pass 2' }))
    expect(onJump).toHaveBeenCalledWith(2)
  })

  it('reports show-only-latest', async () => {
    const { onShowOnlyLatest } = renderLegend()
    await userEvent.click(screen.getByRole('button', { name: 'Show only latest' }))
    expect(onShowOnlyLatest).toHaveBeenCalledTimes(1)
  })
})
