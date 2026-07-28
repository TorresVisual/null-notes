import { describe, it, expect } from 'vitest'
import { matchNotes } from './QuickSwitcher'
import type { NoteMetadata } from '../types'

function note(title: string): NoteMetadata {
  return { id: title, title, path: `/ws/${title}.md`, workspace: '/ws', updatedAt: 0 }
}

describe('matchNotes', () => {
  const notes = [note('Algorithms'), note('Data Structures'), note('Calculus II'), note('Calc I')]

  it('returns the first notes when the query is empty', () => {
    expect(matchNotes(notes, '')).toEqual(notes)
  })

  it('matches titles containing the query case-insensitively', () => {
    const results = matchNotes(notes, 'calc')
    expect(results.map((n) => n.title)).toEqual(['Calc I', 'Calculus II'])
  })

  it('ranks a prefix match before a mid-title match', () => {
    const results = matchNotes([note('My Data Notes'), note('Data Structures')], 'data')
    expect(results.map((n) => n.title)).toEqual(['Data Structures', 'My Data Notes'])
  })

  it('excludes titles that do not contain the query', () => {
    expect(matchNotes(notes, 'zzz')).toEqual([])
  })
})
