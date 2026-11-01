import { describe, it, expect } from 'vitest'
import type { BaseRow } from '../types'
import { evaluate, parseExpression, unsupportedFunctions } from './baseExpr'
import type { Expr, Scope } from './baseExpr'
import type { BaseValue } from './baseValue'

const NOW = new Date(2026, 10, 1, 12, 0, 0).getTime()

function makeRow(overrides: Partial<BaseRow> = {}): BaseRow {
  return {
    path: '/ws/Tasks/a.md',
    title: 'A',
    properties: {
      status: 'todo',
      priority: 2,
      due: '2026-11-05',
      done: false,
      'my prop': 1,
      related: '[[B]]',
      items: [1, 2, 3],
    },
    parseError: null,
    ctime: new Date(2026, 9, 1).getTime(),
    mtime: new Date(2026, 9, 20).getTime(),
    size: 120,
    tags: ['task', 'x'],
    links: ['B'],
    backlinks: ['C'],
    ...overrides,
  }
}

const HOME = makeRow({ path: '/ws/Home.md', title: 'Home', properties: { status: 'hub' }, tags: [] })

function parsed(src: string): Expr {
  const result = parseExpression(src)
  if (!result.ok) throw new Error(`${src}: ${result.error}`)
  return result.expr
}

function ev(src: string, formulas: Record<string, string> = {}, row = makeRow()): BaseValue {
  const scope: Scope = {
    row,
    thisRow: HOME,
    root: '/ws',
    now: NOW,
    formulas: Object.fromEntries(Object.entries(formulas).map(([k, v]) => [k, parsed(v)])),
  }
  return evaluate(parsed(src), scope)
}

describe('operators', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['-2 + 5', 3],
    ['2 * -3', -6],
    ['10 % 4', 2],
    ['!false && true || false', true],
    ['1 + 2 == 3 && 4 > 3', true],
    ['false || false', false],
    ['"a" < "b"', true],
    ['3 != 3', false],
    ['status + "!"', 'todo!'],
    ['"n" + 1', 'n1'],
    ['file.name + " - " + status', 'a.md - todo'],
  ])('%s → %j', (src, expected) => {
    expect(ev(src)).toEqual(expected)
  })

  it('returns null for division by zero instead of throwing', () => {
    expect(ev('1 / 0')).toBeNull()
    expect(ev('5 % 0')).toBeNull()
  })

  it('treats a missing property as null', () => {
    expect(ev('missing == null')).toBe(true)
    expect(ev('missing.length')).toBeNull()
    expect(ev('missing + 1')).toBeNull()
    expect(ev('missing > 1')).toBe(false)
  })
})

describe('properties and scope', () => {
  it('resolves note.x, bare x and bracket access', () => {
    expect(ev('note.status')).toBe('todo')
    expect(ev('status')).toBe('todo')
    expect(ev('note["my prop"]')).toBe(1)
  })

  it('resolves formulas, and a cycle is null', () => {
    expect(ev('formula.x', { x: 'priority * 10' })).toBe(20)
    expect(ev('formula.x + 1', { x: 'priority * 10' })).toBe(21)
    expect(ev('formula.a', { a: 'formula.b', b: 'formula.a' })).toBeNull()
  })

  it('reads the embedding note through this', () => {
    expect(ev('this.file.name')).toBe('Home.md')
    expect(ev('this.status')).toBe('hub')
  })

  it('reads file fields relative to the workspace', () => {
    expect(ev('file.path')).toBe('Tasks/a.md')
    expect(ev('file.folder')).toBe('Tasks')
    expect(ev('file.basename')).toBe('a')
    expect(ev('file.ext')).toBe('md')
    expect(ev('file.size')).toBe(120)
    expect(ev('file.inFolder("Tasks")')).toBe(true)
    expect(ev('file.inFolder("Other")')).toBe(false)
  })

  it('reads tags merged from frontmatter, links and backlinks', () => {
    expect(ev('file.hasTag("task")')).toBe(true)
    expect(ev('file.hasTag("nope", "x")')).toBe(true)
    expect(ev('file.hasTag("nope")')).toBe(false)
    expect(ev('file.hasLink("B")')).toBe(true)
    expect(ev('file.hasLink(link("B"))')).toBe(true)
    expect(ev('file.hasLink("Z")')).toBe(false)
    expect(ev('file.hasProperty("status")')).toBe(true)
    expect(ev('file.hasProperty("nope")')).toBe(false)
  })

  it('reads a wikilink property as a link', () => {
    expect(ev('related == link("B")')).toBe(true)
    expect(ev('related.linksTo("B")')).toBe(false)
  })
})

describe('dates', () => {
  it('compares a date property with today()', () => {
    expect(ev('due < today()')).toBe(false)
    expect(ev('due > today()')).toBe(true)
    expect(ev('due == date("2026-11-05")')).toBe(true)
  })

  it('subtracts dates into a duration', () => {
    expect(ev('file.mtime - file.ctime')).toMatchObject({ __type: 'duration', ms: 19 * 86_400_000 })
  })

  it('adds and subtracts duration strings', () => {
    expect(ev('file.mtime > now() - "7d"')).toBe(false)
    expect(ev('file.mtime > now() - "30d"')).toBe(true)
    expect(ev('(date("2026-01-31") + "1M").format("YYYY-MM-DD")')).toBe('2026-02-28')
    expect(ev('(due + "2w").format("YYYY-MM-DD")')).toBe('2026-11-19')
    expect(ev('(today() + duration("1 day")).format("YYYY-MM-DD")')).toBe('2026-11-02')
  })

  it('exposes fields and formatting', () => {
    expect(ev('now().year')).toBe(2026)
    expect(ev('now().month')).toBe(11)
    expect(ev('today().format("YYYY-MM-DD")')).toBe('2026-11-01')
    expect(ev('date("2026-11-05").format("DD.MM.YYYY")')).toBe('05.11.2026')
    expect(ev('now().date().format("HH:mm")')).toBe('00:00')
    expect(ev('now().format("HH:mm")')).toBe('12:00')
  })
})

describe('function library', () => {
  it.each([
    ['items.contains(2)', true],
    ['items.containsAll(1, 2)', true],
    ['items.containsAny(9, 3)', true],
    ['items.map(value * 2)', [2, 4, 6]],
    ['items.map(value + index)', [1, 3, 5]],
    ['items.filter(value > 1)', [2, 3]],
    ['items.reduce(acc + value, 0)', 6],
    ['items.length', 3],
    ['items.join("-")', '1-2-3'],
    ['items.slice(1)', [2, 3]],
    ['items.reverse()', [3, 2, 1]],
    ['list(5)', [5]],
    ['list(items).isEmpty()', false],
    ['tags.contains("x")', true],
    ['status.lower()', 'todo'],
    ['status.title()', 'Todo'],
    ['"a,b".split(",")', ['a', 'b']],
    ['status.contains("to")', true],
    ['status.startsWith("t")', true],
    ['status.endsWith("x")', false],
    ['"abc".slice(1)', 'bc'],
    ['"x".repeat(3)', 'xxx'],
    ['"  hi ".trim()', 'hi'],
    ['status.replace("o", "0")', 't0do'],
    ['status.replace(/o/g, "0")', 't0d0'],
    ['/^to/.matches(status)', true],
    ['status.length', 4],
    ['(2.567).round(2)', 2.57],
    ['priority.toFixed(2)', '2.00'],
    ['(-3).abs()', 3],
    ['(2.1).ceil()', 3],
    ['(2.9).floor()', 2],
    ['min(3, 1, 2)', 1],
    ['max(3, 1, 2)', 3],
    ['number("5") + 1', 6],
    ['if(true, "a", "b")', 'a'],
    ['if(false, "a")', null],
    ['escapeHTML("<b>")', '&lt;b&gt;'],
    ['status.isEmpty()', false],
    ['"".isEmpty()', true],
    ['priority.isType("number")', true],
    ['priority.toString()', '2'],
  ])('%s → %j', (src, expected) => {
    expect(ev(src)).toEqual(expected)
  })
})

describe('unsupported functions', () => {
  it('evaluates an unknown function to null and reports its name', () => {
    expect(ev('foo(1)')).toBeNull()
    const expr = parsed('foo(1) && status.bar() && status.lower() == "x" && now() > 0')
    expect(unsupportedFunctions(expr)).toEqual(['foo', 'bar'])
  })
})

describe('parseExpression', () => {
  it.each(['(1 + 2', '1 +', '"unterminated', '1 2', 'a..b', ')'])('rejects %j with a position', (src) => {
    const result = parseExpression(src)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/position \d+/)
  })
})
