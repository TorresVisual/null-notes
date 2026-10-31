import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutgoingLinksPanel } from './OutgoingLinksPanel'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { LINK_MENTION_EVENT } from '../editor/linkMention'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

vi.mock('../lib/tauri', () => ({
  api: { notes: { create: vi.fn() } },
}))

const create = vi.mocked(api.notes.create)
const note = (path: string, title: string): NoteMetadata => ({
  id: path,
  title,
  path: `/ws/${path}`,
  workspace: '/ws',
  updatedAt: 0,
})

beforeEach(() => {
  create.mockReset()
  useWorkspaceStore.setState({ path: '/ws', openTabs: [], activeTab: null, selectedFolder: null })
  useNotesStore.setState({
    notes: [note('Self.md', 'Self'), note('A/Sheet.md', 'Sheet'), note('B/Sheet.md', 'Sheet'), note('Graphs.md', 'Graphs')],
  })
})

describe('OutgoingLinksPanel', () => {
  it('lists links, unresolved targets and possible links, showing shared titles with folders', async () => {
    render(<OutgoingLinksPanel notePath="/ws/Self.md" content={'[[Sheet]] [[Sheet]] [[Missing]]\n\nWe cover graphs here.'} />)

    expect(await screen.findByText('Links (1)')).toBeInTheDocument()
    expect(screen.getAllByText('Sheet')).toHaveLength(2)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('Unresolved (1)')).toBeInTheDocument()
    expect(screen.getByText('Possible links (1)')).toBeInTheDocument()
  })

  it('creates the note behind an unresolved link', async () => {
    const user = userEvent.setup()
    create.mockResolvedValue(note('Missing.md', 'Missing'))
    render(<OutgoingLinksPanel notePath="/ws/Self.md" content="[[Missing]]" />)

    await user.click(await screen.findByText('Missing'))

    expect(create).toHaveBeenCalledWith('/ws', '/ws', 'Missing')
  })

  it('asks the editor to link a possible mention', async () => {
    const user = userEvent.setup()
    const heard = vi.fn()
    window.addEventListener(LINK_MENTION_EVENT, heard)
    render(<OutgoingLinksPanel notePath="/ws/Self.md" content="We cover graphs here." />)

    await user.click(await screen.findByText('Graphs'))

    expect((heard.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ notePath: '/ws/Self.md', title: 'Graphs' })
    window.removeEventListener(LINK_MENTION_EVENT, heard)
  })
})
