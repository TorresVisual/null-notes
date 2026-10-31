import { describe, it, expect } from 'vitest'
import {
  deletePass,
  edgeEnds,
  isSafeWorkspacePath,
  markEdited,
  membersOf,
  parseCanvas,
  passColorIndex,
  resolveColor,
  serializeCanvas,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
} from './jsonCanvas'

function node(id: string, x: number, y: number, extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: 'text', x, y, width: 100, height: 50, ...extra }
}

function edge(id: string, fromNode: string, toNode: string, extra: Partial<CanvasEdge> = {}): CanvasEdge {
  return { id, fromNode, toNode, ...extra }
}

function parsed(raw: string): Canvas {
  const result = parseCanvas(raw)
  if (!result.ok) throw new Error(result.error)
  return result.canvas
}

describe('parseCanvas', () => {
  it('treats a whitespace-only file as an empty canvas', () => {
    const result = parseCanvas('  \n')
    expect(result).toEqual({ ok: true, canvas: { nodes: [], edges: [], lastPass: 0 } })
  })

  it('treats a zero-byte file as an empty canvas', () => {
    expect(parseCanvas('').ok).toBe(true)
  })

  it('fails on malformed JSON', () => {
    expect(parseCanvas('{').ok).toBe(false)
  })

  it('fails when the root is not an object', () => {
    expect(parseCanvas('[]').ok).toBe(false)
  })

  it('fails when nodes is not an array', () => {
    expect(parseCanvas('{"nodes":{}}').ok).toBe(false)
  })

  it('defaults missing lastPass to the highest pass present', () => {
    const canvas = parsed(
      JSON.stringify({
        nodes: [node('a', 0, 0, { pass: 2 })],
        edges: [edge('e', 'a', 'a', { pass: 3 })],
      }),
    )
    expect(canvas.lastPass).toBe(3)
  })

  it('defaults missing lastPass to 0 when no element has a pass', () => {
    expect(parsed('{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":1,"height":1}]}').lastPass).toBe(0)
  })

  it('keeps an edge whose target node does not exist', () => {
    const canvas = parsed(JSON.stringify({ nodes: [node('a', 0, 0)], edges: [edge('e', 'a', 'ghost')] }))
    expect(canvas.edges).toHaveLength(1)
  })

  it('keeps duplicate ids and unknown node types', () => {
    const canvas = parsed(
      JSON.stringify({ nodes: [node('a', 0, 0), node('a', 5, 5, { type: 'hologram' })], edges: [] }),
    )
    expect(canvas.nodes.map((n) => n.type)).toEqual(['text', 'hologram'])
  })
})

describe('serializeCanvas', () => {
  it('round-trips unknown top-level and element fields', () => {
    const raw = JSON.stringify({
      nodes: [node('a', 0, 0, { link: 'https://x', mystery: { deep: [1] } })],
      edges: [edge('e', 'a', 'a', { fromSide: 'bottom', toEnd: 'none' })],
      lastPass: 1,
      futureField: 'kept',
    })
    expect(JSON.parse(serializeCanvas(parsed(raw)))).toEqual(JSON.parse(raw))
  })

  it('is stable: serialising twice gives the same text', () => {
    const once = serializeCanvas(parsed('{"nodes":[],"edges":[],"lastPass":2,"z":1}'))
    expect(serializeCanvas(parsed(once))).toBe(once)
  })

  it('puts each node on its own lines with 2-space indent', () => {
    const text = serializeCanvas({ nodes: [node('a', 0, 0), node('b', 1, 1)], edges: [], lastPass: 0 })
    expect(text.startsWith('{\n  "nodes": [\n    {\n      "id": "a"')).toBe(true)
  })

  it('writes nodes, edges, lastPass in that order before extras', () => {
    const text = serializeCanvas({ extra: 1, lastPass: 1, edges: [], nodes: [] })
    expect(Object.keys(JSON.parse(text))).toEqual(['nodes', 'edges', 'lastPass', 'extra'])
  })
})

describe('passColorIndex', () => {
  it('cycles through 1..8', () => {
    expect(passColorIndex(1)).toBe(1)
    expect(passColorIndex(8)).toBe(8)
    expect(passColorIndex(9)).toBe(1)
    expect(passColorIndex(16)).toBe(8)
  })
})

describe('membersOf', () => {
  const group = node('g', 0, 0, { type: 'group', width: 400, height: 300 })

  it('returns nodes fully inside the group rect', () => {
    const inside = node('in', 10, 10)
    const straddling = node('half', 350, 10)
    const outside = node('out', 500, 500)
    const canvas: Canvas = { nodes: [group, inside, straddling, outside], edges: [], lastPass: 0 }
    expect(membersOf(canvas, 'g').map((n) => n.id)).toEqual(['in'])
  })

  it('returns nothing for an unknown group', () => {
    expect(membersOf({ nodes: [group], edges: [], lastPass: 0 }, 'nope')).toEqual([])
  })
})

describe('deletePass', () => {
  const canvas: Canvas = {
    nodes: [
      node('g1', 0, 0, { type: 'group', width: 400, height: 300, pass: 1, author: 'agent' }),
      node('q1', 10, 10, { pass: 1, author: 'agent' }),
      node('mine', 20, 100),
      node('g2', 500, 0, { type: 'group', pass: 2, author: 'agent' }),
      node('other', 510, 10, { pass: 2, author: 'agent' }),
    ],
    edges: [
      edge('agentEdge', 'q1', 'q1', { pass: 1, author: 'agent' }),
      edge('handDrawn', 'mine', 'q1'),
      edge('keep', 'mine', 'other'),
    ],
    lastPass: 2,
  }

  it('removes the pass group, its cards and its edges', () => {
    const next = deletePass(canvas, 1)
    expect(next.nodes.map((n) => n.id)).toEqual(['mine', 'g2', 'other'])
    expect(next.edges.map((e) => e.id)).not.toContain('agentEdge')
  })

  it('keeps a hand-added card inside the pass rect but drops its edge to a removed card', () => {
    const next = deletePass(canvas, 1)
    expect(next.nodes.map((n) => n.id)).toContain('mine')
    expect(next.edges.map((e) => e.id)).toEqual(['keep'])
  })

  it('leaves lastPass unchanged', () => {
    expect(deletePass(canvas, 2).lastPass).toBe(2)
  })
})

describe('markEdited', () => {
  it('flags an agent card whose text changed', () => {
    const next = markEdited(node('a', 0, 0, { pass: 1, author: 'agent', text: 'old' }), 'new')
    expect(next.text).toBe('new')
    expect(next.edited).toBe(true)
  })

  it('does not flag an agent card when the text is unchanged', () => {
    expect(markEdited(node('a', 0, 0, { pass: 1, text: 'same' }), 'same').edited).toBeUndefined()
  })

  it('does not flag a user card', () => {
    const next = markEdited(node('a', 0, 0, { text: 'old' }), 'new')
    expect(next.text).toBe('new')
    expect(next.edited).toBeUndefined()
  })
})

describe('resolveColor', () => {
  it('accepts presets 1-6 as strings', () => {
    expect(resolveColor('3')).toEqual({ kind: 'preset', index: 3 })
  })

  it('accepts short and long hex', () => {
    expect(resolveColor('#FF0000')).toEqual({ kind: 'hex', value: '#FF0000' })
    expect(resolveColor('#f00')).toEqual({ kind: 'hex', value: '#f00' })
  })

  it('rejects anything else, including CSS injection', () => {
    expect(resolveColor('red; background:url(x)')).toBeNull()
    expect(resolveColor('7')).toBeNull()
    expect(resolveColor(3)).toBeNull()
    expect(resolveColor(undefined)).toBeNull()
  })
})

describe('edgeEnds', () => {
  it('defaults to no start marker and an end arrow', () => {
    expect(edgeEnds(edge('e', 'a', 'b'))).toEqual({ from: 'none', to: 'arrow' })
  })

  it('honours explicit ends', () => {
    expect(edgeEnds(edge('e', 'a', 'b', { toEnd: 'none' })).to).toBe('none')
    expect(edgeEnds(edge('e', 'a', 'b', { fromEnd: 'arrow' })).from).toBe('arrow')
  })
})

describe('isSafeWorkspacePath', () => {
  it('accepts plain relative paths, including spaces', () => {
    expect(isSafeWorkspacePath('src/net/retry.ts')).toBe(true)
    expect(isSafeWorkspacePath('Lecture 7.assets/a.png')).toBe(true)
  })

  it.each(['', '/x', 'C:\\x', '\\\\server\\share', '..\\secret', 'a/../b', './a', 'a//b', 'a/'])(
    'rejects %j',
    (path) => {
      expect(isSafeWorkspacePath(path)).toBe(false)
    },
  )
})
