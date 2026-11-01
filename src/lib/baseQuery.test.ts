import { describe, it, expect } from 'vitest'
import type { BaseRow } from '../types'
import type { BaseFile } from './baseFile'
import { runView } from './baseQuery'

function row(name: string, properties: Record<string, unknown>, tags: string[] = []): BaseRow {
  return {
    path: `/ws/${name}.md`,
    title: name,
    properties,
    parseError: null,
    ctime: 0,
    mtime: 0,
    size: 1,
    tags,
    links: [],
    backlinks: [],
  }
}

const ROWS = [
  row('Alpha', { status: 'todo', priority: 2, area: 'cs' }, ['task']),
  row('Beta', { status: 'done', priority: 1, area: 'math' }, ['task']),
  row('Gamma', { status: 'todo', area: 'cs' }, ['task', 'urgent']),
  row('Delta', { status: 'todo', priority: 3 }),
  row('Epsilon', {}, ['other']),
]

function names(result: ReturnType<typeof runView>): string[][] {
  return result.groups.map((g) => g.rows.map((r) => r.title))
}

function base(partial: Partial<BaseFile> & { view?: Record<string, unknown> }): BaseFile {
  const { view, ...rest } = partial
  return { ...rest, views: [{ type: 'table', name: 'T', ...view }] }
}

describe('runView', () => {
  it('applies the base filter and the view filter together', () => {
    const result = runView(
      base({ filters: 'file.hasTag("task")', view: { filters: 'status == "todo"' } }),
      0,
      ROWS,
      null,
    )
    expect(names(result)).toEqual([['Alpha', 'Gamma']])
  })

  it('supports and / or / not groups', () => {
    const or = runView(base({ filters: { or: ['status == "done"', 'priority == 3'] } }), 0, ROWS, null)
    expect(names(or)).toEqual([['Beta', 'Delta']])
    const not = runView(base({ filters: { not: ['status == "todo"', 'file.hasTag("other")'] } }), 0, ROWS, null)
    expect(names(not)).toEqual([['Beta']])
    const nested = runView(
      base({ filters: { and: ['file.hasTag("task")', { or: ['status == "done"', 'priority == 2'] }] } }),
      0,
      ROWS,
      null,
    )
    expect(names(nested)).toEqual([['Alpha', 'Beta']])
  })

  it('sorts ASC and DESC with missing values last either way', () => {
    const asc = runView(base({ view: { sort: [{ property: 'priority', direction: 'ASC' }] } }), 0, ROWS, null)
    expect(names(asc)[0]).toEqual(['Beta', 'Alpha', 'Delta', 'Gamma', 'Epsilon'])
    const desc = runView(base({ view: { sort: [{ property: 'priority', direction: 'DESC' }] } }), 0, ROWS, null)
    expect(names(desc)[0]).toEqual(['Delta', 'Alpha', 'Beta', 'Gamma', 'Epsilon'])
  })

  it('sorts by a second key when the first ties', () => {
    const result = runView(
      base({ view: { sort: [{ property: 'status', direction: 'ASC' }, { property: 'file.name', direction: 'DESC' }] } }),
      0,
      ROWS,
      null,
    )
    expect(names(result)[0]).toEqual(['Beta', 'Gamma', 'Delta', 'Alpha', 'Epsilon'])
  })

  it('groups by a property, sorted by direction, with "No value" last', () => {
    const result = runView(
      base({ view: { groupBy: { property: 'status', direction: 'DESC' }, sort: [{ property: 'file.name', direction: 'ASC' }] } }),
      0,
      ROWS,
      null,
    )
    expect(result.groups.map((g) => g.label)).toEqual(['todo', 'done', 'No value'])
    expect(names(result)).toEqual([['Alpha', 'Delta', 'Gamma'], ['Beta'], ['Epsilon']])
    expect(result.groups[2]?.key).toBeNull()
  })

  it('puts a row in one group per list element, and an empty list under "No value"', () => {
    const rows = [row('A', { tags: ['x', 'y'] }, ['x', 'y']), row('B', { tags: ['y'] }, ['y']), row('C', { tags: [] })]
    const result = runView(base({ view: { groupBy: { property: 'tags' } } }), 0, rows, null)
    expect(result.groups.map((g) => g.label)).toEqual(['x', 'y', 'No value'])
    expect(names(result)).toEqual([['A'], ['A', 'B'], ['C']])
  })

  it('orders groups by groupOrder and keeps listed empty groups', () => {
    const result = runView(
      base({ view: { groupBy: { property: 'status' }, groupOrder: ['done', 'blocked', 'todo'] } }),
      0,
      ROWS,
      null,
    )
    expect(result.groups.map((g) => g.label)).toEqual(['done', 'blocked', 'todo', 'No value'])
    expect(result.groups[1]?.rows).toEqual([])
  })

  it('uses order for columns, displayName for labels and formulas for cells', () => {
    const result = runView(
      base({
        formulas: { double: 'priority * 2' },
        properties: { status: { displayName: 'State' } },
        view: { order: ['file.name', 'status', 'formula.double', 'note.area'] },
      }),
      0,
      ROWS,
      null,
    )
    expect(result.columns).toEqual([
      { id: 'file.name', label: 'Name' },
      { id: 'status', label: 'State' },
      { id: 'formula.double', label: 'double' },
      { id: 'note.area', label: 'area' },
    ])
    const alpha = ROWS[0] as BaseRow
    expect(result.cell(alpha, 'formula.double')).toBe(4)
    expect(result.cell(alpha, 'status')).toBe('todo')
  })

  it('applies limit after sorting', () => {
    const result = runView(
      base({ view: { limit: 2, sort: [{ property: 'file.name', direction: 'DESC' }] } }),
      0,
      ROWS,
      null,
    )
    expect(names(result)[0]).toEqual(['Gamma', 'Epsilon'])
  })

  it('flags an unknown function and keeps the rows it could not judge', () => {
    const result = runView(base({ filters: 'fancy(status)', view: { filters: 'status == "done"' } }), 0, ROWS, null)
    expect(result.unsupported).toEqual(['fancy'])
    expect(names(result)).toEqual([['Beta']])
  })

  it('reports a bad expression and a bad formula without throwing', () => {
    const result = runView(base({ filters: 'status ==', formulas: { x: '(1 +' } }), 0, ROWS, null)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toMatch(/position/)
    expect(names(result)[0]).toHaveLength(5)
  })

  it('resolves this against the supplied row', () => {
    const home = row('Home', { area: 'cs' })
    const result = runView(base({ filters: 'area == this.area' }), 0, ROWS, home)
    expect(names(result)).toEqual([['Alpha', 'Gamma']])
  })

  it('returns an error result for a missing view index', () => {
    const result = runView(base({}), 3, ROWS, null)
    expect(result.errors).toHaveLength(1)
    expect(result.groups).toEqual([])
  })
})
