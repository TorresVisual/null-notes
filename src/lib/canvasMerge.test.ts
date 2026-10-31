import { describe, it, expect } from 'vitest'
import { mergeCanvas } from './canvasMerge'
import type { Canvas, CanvasEdge, CanvasNode } from './jsonCanvas'

function node(id: string, x = 0, y = 0, extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: 'text', x, y, width: 100, height: 50, ...extra }
}

function canvas(nodes: CanvasNode[], edges: CanvasEdge[] = [], lastPass = 0): Canvas {
  return { nodes, edges, lastPass }
}

const ids = (c: Canvas) => c.nodes.map((n) => n.id)

describe('mergeCanvas', () => {
  it('keeps my move and adds a whole pass the agent appended', () => {
    const base = canvas([node('a')], [], 1)
    const mine = canvas([node('a', 40, 40)], [], 1)
    const theirs = canvas(
      [
        node('a'),
        node('g2', 0, 400, { type: 'group', pass: 2, author: 'agent' }),
        node('q2', 10, 410, { pass: 2, author: 'agent' }),
        node('c2', 10, 500, { pass: 2, author: 'agent' }),
      ],
      [{ id: 'e2', fromNode: 'q2', toNode: 'c2', pass: 2, author: 'agent' }],
      2,
    )
    const result = mergeCanvas(base, mine, theirs)
    if (!('merged' in result)) throw new Error('expected merge')
    expect(ids(result.merged)).toEqual(['a', 'g2', 'q2', 'c2'])
    expect(result.merged.nodes[0]).toMatchObject({ x: 40, y: 40 })
    expect(result.merged.edges.map((e) => e.id)).toEqual(['e2'])
    expect(result.merged.lastPass).toBe(2)
  })

  it('takes their change when only they changed an element', () => {
    const base = canvas([node('a')])
    const result = mergeCanvas(base, base, canvas([node('a', 9, 9)]))
    expect(result).toEqual({ merged: canvas([node('a', 9, 9)]) })
  })

  it('reports a conflict when both moved the same card differently', () => {
    const base = canvas([node('a')])
    const result = mergeCanvas(base, canvas([node('a', 1, 1)]), canvas([node('a', 2, 2)]))
    expect(result).toEqual({ conflicts: ['a'] })
  })

  it('keeps my deletion when they left the element alone', () => {
    const base = canvas([node('a'), node('b')])
    const result = mergeCanvas(base, canvas([node('b')]), base)
    if (!('merged' in result)) throw new Error('expected merge')
    expect(ids(result.merged)).toEqual(['b'])
  })

  it('reports a conflict when I deleted what they edited', () => {
    const base = canvas([node('a')])
    const result = mergeCanvas(base, canvas([]), canvas([node('a', 5, 5)]))
    expect(result).toEqual({ conflicts: ['a'] })
  })

  it('returns mine unchanged when both sides agree', () => {
    const base = canvas([node('a')])
    const same = canvas([node('a', 3, 3)])
    expect(mergeCanvas(base, same, canvas([node('a', 3, 3)]))).toEqual({ merged: same })
  })

  it('takes the larger lastPass', () => {
    const base = canvas([], [], 1)
    const result = mergeCanvas(base, canvas([], [], 3), canvas([], [], 2))
    expect(result).toEqual({ merged: canvas([], [], 3) })
  })

  it('treats key order differences as equal', () => {
    const base = canvas([node('a')])
    const reordered = canvas([{ height: 50, width: 100, y: 0, x: 0, type: 'text', id: 'a' }])
    expect(mergeCanvas(base, reordered, base)).toEqual({ merged: reordered })
  })

  it('merges edges the same way as nodes', () => {
    const base = canvas([node('a'), node('b')], [{ id: 'e', fromNode: 'a', toNode: 'b' }])
    const mine = canvas(base.nodes, [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'mine' }])
    const theirs = canvas(base.nodes, [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'theirs' }])
    expect(mergeCanvas(base, mine, theirs)).toEqual({ conflicts: ['e'] })
  })
})
