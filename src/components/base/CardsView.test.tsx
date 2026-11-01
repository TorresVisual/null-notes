import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BaseRow } from '../../types'
import type { BaseFile } from '../../lib/baseFile'
import { runView } from '../../lib/baseQuery'
import { CardsView } from './CardsView'

function row(name: string, properties: Record<string, unknown>): BaseRow {
  return { path: `/ws/${name}.md`, title: name, properties, parseError: null, ctime: 0, mtime: 0, size: 0, tags: [], links: [], backlinks: [] }
}

const ROWS = [row('Alpha', { status: 'todo', cover: 'https://example.com/a.png' }), row('Beta', { status: 'done' })]
const BASE: BaseFile = {
  views: [{ type: 'cards', name: 'C', order: ['file.name', 'status'], image: 'cover', imageFit: 'contain' }],
}

describe('CardsView', () => {
  it('renders a card per row with its other columns and opens the note', async () => {
    const onOpen = vi.fn()
    const view = BASE.views[0]
    if (!view) throw new Error('fixture')
    render(
      <CardsView result={runView(BASE, 0, ROWS, null)} rows={ROWS} view={view} onWrite={vi.fn()} onCreate={vi.fn()} onOpen={onOpen} />,
    )
    expect(screen.getByText('todo')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Beta' }))
    expect(onOpen).toHaveBeenCalledWith('/ws/Beta.md')
  })

  it('shows the image property when it is a web URL', () => {
    const view = BASE.views[0]
    if (!view) throw new Error('fixture')
    render(
      <CardsView result={runView(BASE, 0, ROWS, null)} rows={ROWS} view={view} onWrite={vi.fn()} onCreate={vi.fn()} onOpen={vi.fn()} />,
    )
    const images = document.querySelectorAll('img')
    expect(images).toHaveLength(1)
    expect(images[0]?.getAttribute('src')).toBe('https://example.com/a.png')
  })
})
