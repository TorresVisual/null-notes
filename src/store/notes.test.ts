import { describe, it, expect, beforeEach } from 'vitest'
import { useNotesStore, noteTitle } from './notes'

const reset = () => useNotesStore.setState({ notes: [], folders: [], tags: [] })

describe('useNotesStore', () => {
  beforeEach(reset)

  it('setFolders replaces the folder list', () => {
    useNotesStore.getState().setFolders(['/ws/A', '/ws/B'])
    expect(useNotesStore.getState().folders).toEqual(['/ws/A', '/ws/B'])
  })

  it('setTags replaces the tag list', () => {
    useNotesStore.getState().setTags(['cs101', 'midterm'])
    expect(useNotesStore.getState().tags).toEqual(['cs101', 'midterm'])
  })

  it('addNote prepends a note to the list', () => {
    const note = { id: '1', title: 'A', path: '/ws/a.md', workspace: '/ws', updatedAt: 0 }
    useNotesStore.getState().addNote(note)
    expect(useNotesStore.getState().notes[0]).toEqual(note)
  })
})

describe('noteTitle', () => {
  it('reads the renamed title, not the unchanged filename', () => {
    const note = { id: '1', title: 'New Title', path: '/ws/old-name.md', workspace: '/ws', updatedAt: 0 }
    expect(noteTitle([note], '/ws/old-name.md')).toBe('New Title')
  })

  it('falls back to the filename when the path is not indexed yet', () => {
    expect(noteTitle([], '/ws/untracked.md')).toBe('untracked')
  })
})
