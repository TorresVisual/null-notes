import { describe, it, expect } from 'vitest'
import { buildGraph, scopeNotes } from './graph'
import type { NoteMetadata } from '../types'

function note(title: string, path: string): NoteMetadata {
  return { id: title, title, path, workspace: '/ws', updatedAt: 0 }
}

describe('buildGraph', () => {
  const notes = [note('A', '/ws/a.md'), note('B', '/ws/b.md'), note('C', '/ws/c.md')]

  it('creates one node per note', () => {
    const { nodes } = buildGraph(notes, [], [])
    expect(nodes).toEqual([
      { id: '/ws/a.md', title: 'A' },
      { id: '/ws/b.md', title: 'B' },
      { id: '/ws/c.md', title: 'C' },
    ])
  })

  it('resolves a link to its target note as an edge', () => {
    const { edges } = buildGraph(notes, [{ sourcePath: '/ws/a.md', targetTitle: 'B' }], [])
    expect(edges).toEqual([{ source: '/ws/a.md', target: '/ws/b.md', kind: 'link' }])
  })

  it('resolves link targets case-insensitively', () => {
    const { edges } = buildGraph(notes, [{ sourcePath: '/ws/a.md', targetTitle: 'b' }], [])
    expect(edges).toHaveLength(1)
  })

  it('drops a link to a title with no matching note', () => {
    const { edges } = buildGraph(notes, [{ sourcePath: '/ws/a.md', targetTitle: 'Missing' }], [])
    expect(edges).toEqual([])
  })

  it('ignores a self-link', () => {
    const { edges } = buildGraph(notes, [{ sourcePath: '/ws/a.md', targetTitle: 'A' }], [])
    expect(edges).toEqual([])
  })

  it('deduplicates a link that appears from both directions', () => {
    const { edges } = buildGraph(
      notes,
      [
        { sourcePath: '/ws/a.md', targetTitle: 'B' },
        { sourcePath: '/ws/b.md', targetTitle: 'A' },
      ],
      [],
    )
    expect(edges).toHaveLength(1)
  })

  it('connects every pair of notes sharing a tag', () => {
    const { edges } = buildGraph(
      notes,
      [],
      [
        { notePath: '/ws/a.md', tag: 'cs101' },
        { notePath: '/ws/b.md', tag: 'cs101' },
        { notePath: '/ws/c.md', tag: 'cs101' },
      ],
    )
    expect(edges).toHaveLength(3)
    expect(edges.every((e) => e.kind === 'tag')).toBe(true)
  })

  it('does not add a tag edge for a tag with only one note', () => {
    const { edges } = buildGraph(notes, [], [{ notePath: '/ws/a.md', tag: 'solo' }])
    expect(edges).toEqual([])
  })

  it('keeps a link edge and a tag edge between the same two notes distinct', () => {
    const { edges } = buildGraph(
      notes,
      [{ sourcePath: '/ws/a.md', targetTitle: 'B' }],
      [
        { notePath: '/ws/a.md', tag: 'cs101' },
        { notePath: '/ws/b.md', tag: 'cs101' },
      ],
    )
    expect(edges).toHaveLength(2)
    expect(edges.map((e) => e.kind).sort()).toEqual(['link', 'tag'])
  })
})

describe('scopeNotes', () => {
  const notes = [
    note('A', '/ws/Course101/a.md'),
    note('B', '/ws/Course101/b.md'),
    note('C', '/ws/Course202/c.md'),
  ]
  const tags = [
    { notePath: '/ws/Course101/a.md', tag: 'midterm' },
    { notePath: '/ws/Course202/c.md', tag: 'final' },
  ]

  it('returns every note for a blank query', () => {
    expect(scopeNotes(notes, tags, '')).toEqual(notes)
  })

  it('filters by folder: substring match on path', () => {
    const scoped = scopeNotes(notes, tags, 'folder:Course101')
    expect(scoped.map((n) => n.title)).toEqual(['A', 'B'])
  })

  it('filters by tag: case-insensitively', () => {
    const scoped = scopeNotes(notes, tags, 'tag:MIDTERM')
    expect(scoped.map((n) => n.title)).toEqual(['A'])
  })

  it('combines folder: and tag: as AND', () => {
    const scoped = scopeNotes(notes, tags, 'folder:Course202 tag:final')
    expect(scoped.map((n) => n.title)).toEqual(['C'])
  })

  it('ignores free text and type:, which do not apply at the note level', () => {
    expect(scopeNotes(notes, tags, 'something type:code')).toEqual(notes)
  })
})
