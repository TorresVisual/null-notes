import { describe, it, expect } from 'vitest'
import type { EdgeChange, NodeChange } from '@xyflow/react'
import {
  addFileCard,
  addTextCard,
  applyEdgeFlowChanges,
  applyFlowChanges,
  connectNodes,
  elementColor,
  groupLabel,
  nodeTypeLabel,
  hiddenForLatestOnly,
  keepSelection,
  selectAllVisible,
  reconnectEdge,
  setEdgeLabel,
  setNodeText,
  toFlow,
} from './canvasFlow'
import type { Canvas, CanvasEdge, CanvasNode } from './jsonCanvas'

function node(id: string, x = 0, y = 0, extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: 'text', x, y, width: 100, height: 50, ...extra }
}

function edge(id: string, fromNode: string, toNode: string, extra: Partial<CanvasEdge> = {}): CanvasEdge {
  return { id, fromNode, toNode, ...extra }
}

function canvas(nodes: CanvasNode[], edges: CanvasEdge[] = []): Canvas {
  return { nodes, edges, lastPass: 0 }
}

const move = (id: string, x: number, y: number): NodeChange => ({
  type: 'position',
  id,
  position: { x, y },
  dragging: false,
})

describe('toFlow', () => {
  it('skips an edge whose target node is missing but keeps the node', () => {
    const flow = toFlow(canvas([node('a')], [edge('e', 'a', 'ghost')]))
    expect(flow.nodes).toHaveLength(1)
    expect(flow.edges).toEqual([])
  })

  it('maps fromSide and toSide to handle ids', () => {
    const flow = toFlow(
      canvas([node('a'), node('b', 300, 0)], [edge('e', 'a', 'b', { fromSide: 'bottom', toSide: 'left' })]),
    )
    expect(flow.edges[0]).toMatchObject({ sourceHandle: 'bottom', targetHandle: 'left' })
  })

  it('picks sides from relative position when none are given', () => {
    const right = toFlow(canvas([node('a'), node('b', 300, 0)], [edge('e', 'a', 'b')]))
    expect(right.edges[0]).toMatchObject({ sourceHandle: 'right', targetHandle: 'left' })
    const above = toFlow(canvas([node('a', 0, 300), node('b')], [edge('e', 'a', 'b')]))
    expect(above.edges[0]).toMatchObject({ sourceHandle: 'top', targetHandle: 'bottom' })
  })

  it('draws an arrow at the end by default and honours toEnd none', () => {
    const nodes = [node('a'), node('b', 300, 0)]
    const dflt = toFlow(canvas(nodes, [edge('e', 'a', 'b')])).edges[0]
    expect(dflt?.markerEnd).toBeTruthy()
    expect(dflt?.markerStart).toBeUndefined()
    const plain = toFlow(canvas(nodes, [edge('e', 'a', 'b', { toEnd: 'none', fromEnd: 'arrow' })])).edges[0]
    expect(plain?.markerEnd).toBeUndefined()
    expect(plain?.markerStart).toBeTruthy()
  })

  it('renders each id once, in array order, even when the file repeats one', () => {
    const flow = toFlow(canvas([node('a'), node('b'), node('a', 9, 9)]))
    expect(flow.nodes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('maps known types and falls back to an inert generic card', () => {
    const flow = toFlow(
      canvas([node('t'), node('f', 0, 0, { type: 'file' }), node('g', 0, 0, { type: 'group' }), node('l', 0, 0, { type: 'link' }), node('h', 0, 0, { type: 'hologram' })]),
    )
    expect(flow.nodes.map((n) => n.type)).toEqual([
      'canvasText',
      'canvasFile',
      'canvasGroup',
      'canvasLink',
      'canvasUnknown',
    ])
  })
})

describe('toFlow with hidden passes', () => {
  const nodes = [
    node('g1', 0, 0, { type: 'group', pass: 1, author: 'agent' }),
    node('c1', 10, 10, { pass: 1, author: 'agent' }),
    node('g2', 500, 0, { type: 'group', pass: 2, author: 'agent' }),
    node('mine', 520, 20),
  ]
  const edges = [edge('agent', 'c1', 'g1', { pass: 1 }), edge('hand', 'mine', 'c1'), edge('keep', 'mine', 'g2')]

  it('hides a pass, its cards and every edge touching them, leaving the rest', () => {
    const flow = toFlow(canvas(nodes, edges), new Set([1]))
    expect(flow.nodes.filter((n) => n.hidden).map((n) => n.id)).toEqual(['g1', 'c1'])
    expect(flow.edges.filter((e) => e.hidden).map((e) => e.id)).toEqual(['agent', 'hand'])
  })

  it('shows everything by default', () => {
    const flow = toFlow(canvas(nodes, edges))
    expect(flow.nodes.some((n) => n.hidden)).toBe(false)
    expect(flow.edges.some((e) => e.hidden)).toBe(false)
  })
})

describe('malformed agent fields', () => {
  it('does not treat a non-integer pass as an agent pass when colouring or labelling', () => {
    expect(elementColor({ pass: 1.5, color: '2' })).toBe('var(--canvas-color-2)')
    expect(elementColor({ pass: {} as unknown as number })).toBeUndefined()
    expect(groupLabel(node('g', 0, 0, { type: 'group', pass: '2' as unknown as number, label: 'x' }))).toBe('x')
  })

  it('names an unknown node type safely even when the file put an object there', () => {
    expect(nodeTypeLabel(node('a', 0, 0, { type: 'hologram' }))).toBe('hologram')
    expect(nodeTypeLabel(node('a', 0, 0, { type: {} as unknown as string }))).toBe('unknown')
  })
})

describe('selection and hidden passes', () => {
  const flow = toFlow(
    canvas([node('g1', 0, 0, { type: 'group', pass: 1 }), node('c1', 0, 0, { pass: 1 }), node('mine', 0, 0)]),
    new Set([1]),
  )

  it('select all never selects a hidden card, so Delete cannot remove a hidden pass', () => {
    const selected = selectAllVisible(flow.nodes).filter((n) => n.selected)
    expect(selected.map((n) => n.id)).toEqual(['mine'])
  })

  it('drops the selection of a card whose pass has just been hidden', () => {
    const before = toFlow(canvas([node('c1', 0, 0, { pass: 1 }), node('mine', 0, 0)])).nodes.map((n) => ({
      ...n,
      selected: true,
    }))
    const after = keepSelection(toFlow(canvas([node('c1', 0, 0, { pass: 1 }), node('mine', 0, 0)]), new Set([1])).nodes, before)
    expect(after.filter((n) => n.selected).map((n) => n.id)).toEqual(['mine'])
  })
})

describe('hiddenForLatestOnly', () => {
  it('hides every pass but the highest', () => {
    expect([...hiddenForLatestOnly([1, 2, 3])].sort()).toEqual([1, 2])
    expect(hiddenForLatestOnly([4]).size).toBe(0)
    expect(hiddenForLatestOnly([]).size).toBe(0)
  })
})

describe('elementColor', () => {
  it('colours agent elements by pass and ignores their own color field', () => {
    expect(elementColor({ pass: 3, author: 'agent', color: '#ff0000' })).toBe('var(--pass-3)')
    expect(elementColor({ pass: 9, author: 'agent' })).toBe('var(--pass-1)')
  })

  it('maps presets to canvas colour variables and passes hex through', () => {
    expect(elementColor({ color: '2' })).toBe('var(--canvas-color-2)')
    expect(elementColor({ color: '#abc' })).toBe('#abc')
  })

  it('returns undefined for an unknown or unsafe color', () => {
    expect(elementColor({ color: 'red; background:url(x)' })).toBeUndefined()
    expect(elementColor({})).toBeUndefined()
  })
})

describe('groupLabel', () => {
  it('keeps an agent label that already names its pass', () => {
    expect(groupLabel(node('g', 0, 0, { type: 'group', pass: 2, label: 'Pass 2 · retries' }))).toBe('Pass 2 · retries')
  })

  it('always shows the pass number, even when the agent left it out', () => {
    expect(groupLabel(node('g', 0, 0, { type: 'group', pass: 3, label: 'retries' }))).toBe('Pass 3 · retries')
    expect(groupLabel(node('g', 0, 0, { type: 'group', pass: 3 }))).toBe('Pass 3')
  })

  it('shows a user group label as written', () => {
    expect(groupLabel(node('g', 0, 0, { type: 'group', label: 'Mine' }))).toBe('Mine')
    expect(groupLabel(node('g', 0, 0, { type: 'group' }))).toBe('')
  })
})

describe('applyFlowChanges', () => {
  it('rounds positions to integers', () => {
    const next = applyFlowChanges(canvas([node('a')]), [move('a', 10.6, -3.4)])
    expect(next.nodes[0]).toMatchObject({ x: 11, y: -3 })
  })

  it('keeps array order (z-order) when the first card is dragged', () => {
    const next = applyFlowChanges(canvas([node('a'), node('b'), node('c')]), [move('a', 50, 50)])
    expect(next.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('updates x/y only and preserves pass and unknown fields', () => {
    const start = canvas([node('a', 0, 0, { pass: 2, author: 'agent', mystery: { deep: 1 }, text: 'hi' })])
    const next = applyFlowChanges(start, [move('a', 7, 8)])
    expect(next.nodes[0]).toEqual({ ...start.nodes[0], x: 7, y: 8 })
  })

  it('moves the cards inside a dragged group by the same delta', () => {
    const start = canvas([
      node('g', 0, 0, { type: 'group', width: 400, height: 300 }),
      node('in', 10, 10),
      node('out', 900, 900),
    ])
    const next = applyFlowChanges(start, [move('g', 20, 30)])
    expect(next.nodes.map((n) => [n.x, n.y])).toEqual([
      [20, 30],
      [30, 40],
      [900, 900],
    ])
  })

  it('does not move a member twice when it is dragged together with its group', () => {
    const start = canvas([node('g', 0, 0, { type: 'group', width: 400, height: 300 }), node('in', 10, 10)])
    const next = applyFlowChanges(start, [move('g', 20, 30), move('in', 30, 40)])
    expect(next.nodes[1]).toMatchObject({ x: 30, y: 40 })
  })

  it('writes resized dimensions as integers', () => {
    const change: NodeChange = {
      type: 'dimensions',
      id: 'a',
      dimensions: { width: 120.4, height: 80.6 },
      resizing: true,
      setAttributes: true,
    }
    const next = applyFlowChanges(canvas([node('a')]), [change])
    expect(next.nodes[0]).toMatchObject({ width: 120, height: 81 })
  })

  it('ignores measurement-only dimension changes', () => {
    const change: NodeChange = { type: 'dimensions', id: 'a', dimensions: { width: 7, height: 7 } }
    const start = canvas([node('a')])
    expect(applyFlowChanges(start, [change])).toEqual(start)
  })

  it('removes a pass card together with every edge touching it', () => {
    const start = canvas(
      [node('q', 0, 0, { pass: 1, author: 'agent' }), node('c', 200, 0, { pass: 1, author: 'agent' }), node('mine', 0, 200)],
      [edge('e1', 'q', 'c', { pass: 1 }), edge('e2', 'mine', 'q'), edge('e3', 'mine', 'c')],
    )
    const next = applyFlowChanges(start, [{ type: 'remove', id: 'q' }])
    expect(next.nodes.map((n) => n.id)).toEqual(['c', 'mine'])
    expect(next.edges.map((e) => e.id)).toEqual(['e3'])
  })
})

describe('applyEdgeFlowChanges', () => {
  it('removes only the named edge, even when a node shares the id', () => {
    const start = canvas([node('x'), node('y')], [edge('x', 'x', 'y'), edge('keep', 'x', 'y')])
    const change: EdgeChange = { type: 'remove', id: 'x' }
    const next = applyEdgeFlowChanges(start, [change])
    expect(next.nodes).toHaveLength(2)
    expect(next.edges.map((e) => e.id)).toEqual(['keep'])
  })
})

describe('reconnectEdge', () => {
  it('changes only the endpoints', () => {
    const start = canvas(
      [node('a'), node('b'), node('c')],
      [edge('e', 'a', 'b', { label: 'why', pass: 1, mystery: 7 })],
    )
    const next = reconnectEdge(start, 'e', 'a', 'c')
    expect(next.edges[0]).toEqual({ id: 'e', fromNode: 'a', toNode: 'c', label: 'why', pass: 1, mystery: 7 })
  })
})

describe('editing helpers', () => {
  it('adds a user text card with no pass or author, appended last', () => {
    const next = addTextCard(canvas([node('a')]), { x: 10.4, y: 20.6 })
    const added = next.nodes[1]
    expect(added).toMatchObject({ type: 'text', x: 10, y: 21, text: '' })
    expect(added?.pass).toBeUndefined()
    expect(added?.author).toBeUndefined()
    expect(added?.id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('adds a file card', () => {
    const next = addFileCard(canvas([]), { x: 0, y: 0 }, 'src/net/retry.ts')
    expect(next.nodes[0]).toMatchObject({ type: 'file', file: 'src/net/retry.ts' })
  })

  it('connects two cards with only the required edge fields', () => {
    const next = connectNodes(canvas([node('a'), node('b')]), 'a', 'b')
    expect(Object.keys(next.edges[0] ?? {}).sort()).toEqual(['fromNode', 'id', 'toNode'])
  })

  it('sets and clears an edge label', () => {
    const start = canvas([node('a'), node('b')], [edge('e', 'a', 'b')])
    const labelled = setEdgeLabel(start, 'e', 'because')
    expect(labelled.edges[0]?.label).toBe('because')
    expect('label' in (setEdgeLabel(labelled, 'e', '').edges[0] ?? {})).toBe(false)
  })

  it('flags an edited agent card but not a moved one', () => {
    const start = canvas([node('a', 0, 0, { pass: 1, author: 'agent', text: 'old' })])
    expect(setNodeText(start, 'a', 'new').nodes[0]).toMatchObject({ text: 'new', edited: true })
    expect(applyFlowChanges(start, [move('a', 5, 5)]).nodes[0]?.edited).toBeUndefined()
  })
})
