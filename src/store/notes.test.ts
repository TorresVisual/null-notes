import { describe, it, expect, beforeEach } from 'vitest'
import { useNotesStore } from './notes'

const reset = () => useNotesStore.setState({ notes: [], folders: [] })

describe('useNotesStore', () => {
  beforeEach(reset)

  it('setFolders replaces the folder list', () => {
    useNotesStore.getState().setFolders(['/ws/A', '/ws/B'])
    expect(useNotesStore.getState().folders).toEqual(['/ws/A', '/ws/B'])
  })

  it('addNote prepends a note to the list', () => {
    const note = { id: '1', title: 'A', path: '/ws/a.md', workspace: '/ws', updatedAt: 0 }
    useNotesStore.getState().addNote(note)
    expect(useNotesStore.getState().notes[0]).toEqual(note)
  })
})
