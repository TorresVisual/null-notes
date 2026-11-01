import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BaseRow } from '../../types'
import type { BaseFile } from '../../lib/baseFile'
import { runView } from '../../lib/baseQuery'
import { TableView } from './TableView'

function row(name: string, properties: Record<string, unknown>): BaseRow {
  return { path: `/ws/${name}.md`, title: name, properties, parseError: null, ctime: 0, mtime: 0, size: 0, tags: [], links: [], backlinks: [] }
}

const ROWS = [row('Alpha', { status: 'todo', done: false }), row('Beta', { status: 'done', done: true })]
const BASE: BaseFile = {
  views: [{ type: 'table', name: 'T', order: ['file.name', 'status', 'done'], groupBy: { property: 'status' } }],
}

function setup() {
  const onWrite = vi.fn()
  const onOpen = vi.fn()
  const view = BASE.views[0]
  if (!view) throw new Error('fixture')
  render(
    <TableView
      result={runView(BASE, 0, ROWS, null)}
      rows={ROWS}
      view={view}
      onWrite={onWrite}
      onCreate={vi.fn()}
      onOpen={onOpen}
    />,
  )
  return { onWrite, onOpen }
}

describe('TableView', () => {
  it('renders rows under a heading per group', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'done' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'todo' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
  })

  it('writes a checkbox edit back through onWrite', async () => {
    const { onWrite } = setup()
    const alpha = screen.getByRole('row', { name: /Alpha/ })
    await userEvent.setup().click(within(alpha).getByRole('checkbox'))
    expect(onWrite).toHaveBeenCalledWith(ROWS[0], 'done', true)
  })

  it('opens the note from its name cell', async () => {
    const { onOpen } = setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Alpha' }))
    expect(onOpen).toHaveBeenCalledWith('/ws/Alpha.md')
  })
})
