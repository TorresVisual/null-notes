import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BasePane } from './BasePane'
import { api } from '../lib/tauri'
import { useBaseRowsStore } from '../store/baseRows'
import { useWorkspaceStore } from '../store/workspace'
import type { BaseRow } from '../types'

vi.mock('../lib/tauri', () => ({
  api: {
    notes: { open: vi.fn(), save: vi.fn() },
    properties: { listRows: vi.fn(), writeProperty: vi.fn(), createNote: vi.fn() },
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))

function row(name: string, properties: Record<string, unknown>): BaseRow {
  return { path: `/ws/${name}.md`, title: name, properties, parseError: null, ctime: 0, mtime: 0, size: 0, tags: [], links: [], backlinks: [] }
}

const BASE_TEXT = 'views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - status\n'

beforeEach(() => {
  vi.mocked(api.notes.save).mockReset()
  vi.mocked(api.notes.open).mockResolvedValue(BASE_TEXT)
  vi.mocked(api.properties.listRows).mockResolvedValue([row('Alpha', { status: 'todo' }), row('Beta', { status: 'done' })])
  useWorkspaceStore.setState({ path: '/ws', gitPendingPaths: [] })
  useBaseRowsStore.setState({ rows: [], workspace: null })
})

describe('BasePane', () => {
  it('lists the rows of the active view', async () => {
    render(<BasePane path="/ws/Tasks.base" />)
    expect(await screen.findByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument()
  })

  it('shows an unsupported marker and still lists the rows', async () => {
    vi.mocked(api.notes.open).mockResolvedValue(`filters: fancy(status)\n${BASE_TEXT}`)
    render(<BasePane path="/ws/Tasks.base" />)
    expect(await screen.findByText(/unsupported/i)).toHaveTextContent('fancy')
    expect(await screen.findByRole('button', { name: 'Alpha' })).toBeInTheDocument()
  })

  it('shows invalid source as an error and does not save it', async () => {
    render(<BasePane path="/ws/Tasks.base" />)
    await screen.findByRole('button', { name: 'Alpha' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit source' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Base source' }), { target: { value: 'views: [\n' } })

    expect(await screen.findByRole('alert')).toHaveTextContent(/line/i)
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(api.notes.save).not.toHaveBeenCalled()
  })

  it('shows a syntax error in the file inline instead of a view', async () => {
    vi.mocked(api.notes.open).mockResolvedValue('views: [\n')
    render(<BasePane path="/ws/Tasks.base" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
