import { describe, it, expect } from 'vitest'
import { createDefaults } from './baseDefaults'

describe('createDefaults', () => {
  it('reads folder and equality filters from base and view filters', () => {
    const defaults = createDefaults(
      { filters: { and: ['file.inFolder("Courses")', 'status == "todo"', 'priority == 2', 'done == false'] }, views: [] },
      { type: 'table', name: 'T', filters: 'note.area == "cs"' },
    )
    expect(defaults).toEqual({
      folder: 'Courses',
      properties: { status: 'todo', priority: 2, done: false, area: 'cs' },
    })
  })

  it('ignores or / not groups and anything it cannot read as a plain equality', () => {
    const defaults = createDefaults(
      {
        filters: { and: [{ or: ['status == "a"', 'status == "b"'] }, { not: ['x == 1'] }, 'file.hasTag("t")', 'a.b == 1', 'n > 2'] },
        views: [],
      },
      { type: 'table', name: 'T' },
    )
    expect(defaults).toEqual({ folder: null, properties: {} })
  })

  it('accepts a single string filter', () => {
    expect(createDefaults({ filters: "status == 'open'", views: [] }, { type: 'table', name: 'T' })).toEqual({
      folder: null,
      properties: { status: 'open' },
    })
  })
})
