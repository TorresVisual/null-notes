import { describe, it, expect } from 'vitest'
import {
  addView,
  parseBase,
  removeView,
  renameView,
  serializeBase,
  setFilters,
  updateView,
} from './baseFile'

const OBSIDIAN = `filters:
  and:
    - file.hasTag("task")
    - 'status != "done"'
formulas:
  overdue: 'if(due < today(), "yes", "")'
properties:
  status:
    displayName: Status
x-unknown: 5   # keep me
views:
  - type: table
    name: Table
    order:
      - file.name
      - status
    sort:
      - property: due
        direction: ASC
  # the cards view
  - type: cards
    name: Cards
    extra: 1
`

function parsed(text: string) {
  const result = parseBase(text)
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('parseBase', () => {
  it('round-trips an Obsidian-authored file byte-identical when nothing changed', () => {
    const { doc, base } = parsed(OBSIDIAN)
    expect(base.views.map((v) => v.type)).toEqual(['table', 'cards'])
    expect(base.formulas?.overdue).toContain('today()')
    expect(base.properties?.status?.displayName).toBe('Status')
    expect(serializeBase(doc)).toBe(OBSIDIAN)
  })

  it('reports a syntax error with its line number', () => {
    const result = parseBase('views:\n  - type: table\n   name: [oops\n')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/line \d+/i)
  })

  it('treats empty text as a base with no views', () => {
    const { base } = parsed('')
    expect(base.views).toEqual([])
  })

  it('rejects a document that is not a mapping', () => {
    expect(parseBase('- a\n- b\n').ok).toBe(false)
  })
})

describe('editing', () => {
  it('keeps unknown keys and comments when a view is updated', () => {
    const { doc } = parsed(OBSIDIAN)
    updateView(doc, 0, { name: 'Renamed', groupBy: { property: 'status', direction: 'ASC' } })
    const out = serializeBase(doc)
    expect(out).toContain('# keep me')
    expect(out).toContain('x-unknown: 5')
    expect(out).toContain('# the cards view')
    const again = parsed(out).base
    expect(again.views[0]).toMatchObject({ name: 'Renamed', groupBy: { property: 'status' } })
    expect(again.views[0]?.sort).toEqual([{ property: 'due', direction: 'ASC' }])
    expect(again.views[1]?.extra).toBe(1)
  })

  it('removes a key when its patch value is undefined', () => {
    const { doc } = parsed(OBSIDIAN)
    updateView(doc, 0, { sort: undefined })
    expect(parsed(serializeBase(doc)).base.views[0]?.sort).toBeUndefined()
  })

  it('adds, renames and removes views', () => {
    const { doc } = parsed(OBSIDIAN)
    addView(doc, { type: 'list', name: 'List' })
    renameView(doc, 2, 'Plain')
    removeView(doc, 0)
    expect(parsed(serializeBase(doc)).base.views.map((v) => v.name)).toEqual(['Cards', 'Plain'])
  })

  it('creates the views list on an empty base', () => {
    const { doc } = parsed('')
    addView(doc, { type: 'table', name: 'Table' })
    expect(parsed(serializeBase(doc)).base.views).toEqual([{ type: 'table', name: 'Table' }])
  })

  it('sets and clears filters', () => {
    const { doc } = parsed(OBSIDIAN)
    setFilters(doc, { or: ['a == 1', 'b == 2'] })
    expect(parsed(serializeBase(doc)).base.filters).toEqual({ or: ['a == 1', 'b == 2'] })
    setFilters(doc, undefined)
    expect(parsed(serializeBase(doc)).base.filters).toBeUndefined()
  })
})
