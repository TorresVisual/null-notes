import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BaseRow } from '../../types'
import type { BaseFile } from '../../lib/baseFile'
import { runView } from '../../lib/baseQuery'
import { KanbanView } from './KanbanView'

function row(name: string, properties: Record<string, unknown>): BaseRow {
  return { path: `/ws/${name}.md`, title: name, properties, parseError: null, ctime: 0, mtime: 0, size: 0, tags: [], links: [], backlinks: [] }
}

const ROWS = [row('Alpha', { status: 'todo' }), row('Beta', { status: 'done' }), row('Loose', {})]
const BASE: BaseFile = {
  views: [{ type: 'kanban', name: 'K', groupBy: { property: 'status' }, groupOrder: ['todo', 'doing', 'done'] }],
}

function setup() {
  const onWrite = vi.fn()
  const onCreate = vi.fn()
  const view = BASE.views[0]
  if (!view) throw new Error('fixture')
  render(
    <KanbanView
      result={runView(BASE, 0, ROWS, null)}
      rows={ROWS}
      view={view}
      onWrite={onWrite}
      onCreate={onCreate}
      onOpen={vi.fn()}
    />,
  )
  return { onWrite, onCreate }
}

const column = (name: string) => screen.getByRole('group', { name })

describe('KanbanView', () => {
  it('renders one column per group, empty ones included, with "No value" last', () => {
    setup()
    const names = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(names).toEqual(['todo', 'doing', 'done', 'No value'])
    expect(within(column('todo')).getByText('Alpha')).toBeInTheDocument()
    expect(within(column('No value')).getByText('Loose')).toBeInTheDocument()
  })

  it('writes the new value when a card is dropped on another column', () => {
    const { onWrite } = setup()
    fireEvent.dragStart(within(column('todo')).getByText('Alpha').closest('[draggable]') as HTMLElement)
    fireEvent.drop(column('doing'))
    expect(onWrite).toHaveBeenCalledWith(ROWS[0], 'status', 'doing')
  })

  it('removes the property when a card is dropped on "No value"', () => {
    const { onWrite } = setup()
    fireEvent.dragStart(within(column('done')).getByText('Beta').closest('[draggable]') as HTMLElement)
    fireEvent.drop(column('No value'))
    expect(onWrite).toHaveBeenCalledWith(ROWS[1], 'status', undefined)
  })

  it('does nothing when dropped on its own column', () => {
    const { onWrite } = setup()
    fireEvent.dragStart(within(column('todo')).getByText('Alpha').closest('[draggable]') as HTMLElement)
    fireEvent.drop(column('todo'))
    expect(onWrite).not.toHaveBeenCalled()
  })

  it('"+ add card" passes the column value', async () => {
    const { onCreate } = setup()
    const user = userEvent.setup()
    await user.click(within(column('doing')).getByRole('button', { name: /add card/i }))
    expect(onCreate).toHaveBeenCalledWith({ status: 'doing' })
    await user.click(within(column('No value')).getByRole('button', { name: /add card/i }))
    expect(onCreate).toHaveBeenLastCalledWith({})
  })
})
