import { describe, it, expect } from 'vitest'
import { groupByNote } from './taskGroups'
import type { OpenTask } from '../types'

function task(notePath: string, noteTitle: string, text: string, position: number): OpenTask {
  return { notePath, noteTitle, text, position }
}

describe('groupByNote', () => {
  it('groups tasks under their note in arrival order', () => {
    const groups = groupByNote([
      task('/ws/a.md', 'Alpha', 'first', 0),
      task('/ws/a.md', 'Alpha', 'second', 1),
      task('/ws/b.md', 'Beta', 'only', 0),
    ])

    expect(groups).toEqual([
      { notePath: '/ws/a.md', noteTitle: 'Alpha', tasks: [task('/ws/a.md', 'Alpha', 'first', 0), task('/ws/a.md', 'Alpha', 'second', 1)] },
      { notePath: '/ws/b.md', noteTitle: 'Beta', tasks: [task('/ws/b.md', 'Beta', 'only', 0)] },
    ])
  })

  it('returns an empty list for no tasks', () => {
    expect(groupByNote([])).toEqual([])
  })

  it('keeps first-seen note order even if the same note appears again later', () => {
    const groups = groupByNote([
      task('/ws/a.md', 'Alpha', 'first', 0),
      task('/ws/b.md', 'Beta', 'interleaved', 0),
      task('/ws/a.md', 'Alpha', 'second', 2),
    ])

    expect(groups.map((g) => g.notePath)).toEqual(['/ws/a.md', '/ws/b.md'])
    expect(groups[0]?.tasks).toHaveLength(2)
  })
})
