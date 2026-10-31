import type { Edge, EdgeChange, MarkerType, Node, NodeChange } from '@xyflow/react'
import {
  edgeEnds,
  passOf,
  markEdited,
  membersOf,
  passColorIndex,
  resolveColor,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
} from './jsonCanvas'

export type CanvasNodeData = { node: CanvasNode }
export type CanvasEdgeData = { edge: CanvasEdge }
export type FlowNode = Node<CanvasNodeData>
export type FlowEdge = Edge<CanvasEdgeData>

type Side = 'top' | 'right' | 'bottom' | 'left'

const NODE_TYPES: Record<string, string> = {
  text: 'canvasText',
  file: 'canvasFile',
  group: 'canvasGroup',
  link: 'canvasLink',
}
const FALLBACK_SIZE = { width: 250, height: 60 }
const ARROW = 'arrowclosed' as MarkerType

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sideOf(value: unknown): Side | undefined {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left' ? value : undefined
}

function centre(n: CanvasNode): { x: number; y: number } {
  return {
    x: finite(n.x, 0) + finite(n.width, FALLBACK_SIZE.width) / 2,
    y: finite(n.y, 0) + finite(n.height, FALLBACK_SIZE.height) / 2,
  }
}

function defaultSides(from: CanvasNode, to: CanvasNode): [Side, Side] {
  const a = centre(from)
  const b = centre(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

/** CSS colour for a card or edge: the app's pass colour for agent elements, the file's own colour otherwise. */
export function elementColor(el: { pass?: number; author?: string; color?: unknown }): string | undefined {
  const pass = passOf(el)
  if (pass !== undefined) return `var(--pass-${passColorIndex(pass)})`
  const color = resolveColor(el.color)
  if (!color) return undefined
  return color.kind === 'preset' ? `var(--canvas-color-${color.index})` : color.value
}

/** The card type as text. The file is untrusted, so a non-string `type` must not reach React as a child. */
export function nodeTypeLabel(node: CanvasNode): string {
  return typeof node.type === 'string' ? node.type : 'unknown'
}

export function groupLabel(node: CanvasNode): string {
  const label = typeof node.label === 'string' ? node.label : ''
  const pass = passOf(node)
  if (pass === undefined || new RegExp(String.raw`^pass\s+${pass}\b`, 'i').test(label)) return label
  return label ? `Pass ${pass} · ${label}` : `Pass ${pass}`
}

/** Carries the previous selection onto fresh nodes, minus anything hidden: a hidden card must not stay deletable. */
export function keepSelection<T extends { id: string; selected?: boolean; hidden?: boolean }>(fresh: T[], previous: T[]): T[] {
  const selected = new Set(previous.filter((p) => p.selected).map((p) => p.id))
  return fresh.map((f) => (selected.has(f.id) && !f.hidden ? { ...f, selected: true } : f))
}

export function selectAllVisible(nodes: FlowNode[]): FlowNode[] {
  return nodes.map((n) => ({ ...n, selected: !n.hidden }))
}

/** Passes to hide so only the newest one shows. */
export function hiddenForLatestOnly(passes: readonly number[]): Set<number> {
  const latest = Math.max(...passes)
  return new Set(passes.filter((p) => p !== latest))
}

export function toFlow(
  canvas: Canvas,
  hiddenPasses: ReadonlySet<number> = new Set(),
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const isHidden = (el: { pass?: unknown }) => {
    const pass = passOf(el)
    return pass !== undefined && hiddenPasses.has(pass)
  }
  const hiddenIds = new Set(canvas.nodes.filter(isHidden).map((n) => n.id))
  const byId = new Map<string, CanvasNode>()
  const nodes: FlowNode[] = []
  for (const n of canvas.nodes) {
    if (byId.has(n.id)) continue
    byId.set(n.id, n)
    nodes.push({
      id: n.id,
      type: NODE_TYPES[n.type] ?? 'canvasUnknown',
      position: { x: finite(n.x, 0), y: finite(n.y, 0) },
      width: finite(n.width, FALLBACK_SIZE.width),
      height: finite(n.height, FALLBACK_SIZE.height),
      hidden: hiddenIds.has(n.id),
      data: { node: n },
    })
  }

  const seen = new Set<string>()
  const edges: FlowEdge[] = []
  for (const e of canvas.edges) {
    const from = byId.get(e.fromNode)
    const to = byId.get(e.toNode)
    if (!from || !to || seen.has(e.id)) continue
    seen.add(e.id)
    const [fromSide, toSide] = defaultSides(from, to)
    const ends = edgeEnds(e)
    const color = elementColor(e)
    edges.push({
      id: e.id,
      source: e.fromNode,
      target: e.toNode,
      sourceHandle: sideOf(e.fromSide) ?? fromSide,
      targetHandle: sideOf(e.toSide) ?? toSide,
      label: typeof e.label === 'string' && e.label !== '' ? e.label : undefined,
      markerStart: ends.from === 'arrow' ? { type: ARROW, color } : undefined,
      markerEnd: ends.to === 'arrow' ? { type: ARROW, color } : undefined,
      style: color ? { stroke: color } : undefined,
      hidden: isHidden(e) || hiddenIds.has(e.fromNode) || hiddenIds.has(e.toNode),
      data: { edge: e },
    })
  }
  return { nodes, edges }
}

function withoutNodes(canvas: Canvas, removed: ReadonlySet<string>): Canvas {
  return {
    ...canvas,
    nodes: canvas.nodes.filter((n) => !removed.has(n.id)),
    edges: canvas.edges.filter((e) => !removed.has(e.fromNode) && !removed.has(e.toNode)),
  }
}

export function applyFlowChanges(canvas: Canvas, changes: readonly NodeChange[]): Canvas {
  const dragged = new Set(changes.flatMap((c) => (c.type === 'position' && c.position ? [c.id] : [])))
  let next = canvas
  const removed = new Set<string>()

  for (const change of changes) {
    if (change.type === 'remove') {
      removed.add(change.id)
    } else if (change.type === 'position' && change.position) {
      const x = Math.round(change.position.x)
      const y = Math.round(change.position.y)
      const target = next.nodes.find((n) => n.id === change.id)
      if (!target) continue
      const dx = x - target.x
      const dy = y - target.y
      // Cards the user is dragging along with the group already carry their own change.
      const carried =
        target.type === 'group'
          ? new Set(membersOf(next, target.id).filter((m) => !dragged.has(m.id)).map((m) => m.id))
          : new Set<string>()
      next = {
        ...next,
        nodes: next.nodes.map((n) => {
          if (n.id === change.id) return { ...n, x, y }
          return carried.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n
        }),
      }
    } else if (change.type === 'dimensions' && change.dimensions && (change.resizing !== undefined || change.setAttributes)) {
      const width = Math.round(change.dimensions.width)
      const height = Math.round(change.dimensions.height)
      next = { ...next, nodes: next.nodes.map((n) => (n.id === change.id ? { ...n, width, height } : n)) }
    }
  }
  return removed.size > 0 ? withoutNodes(next, removed) : next
}

export function applyEdgeFlowChanges(canvas: Canvas, changes: readonly EdgeChange[]): Canvas {
  const removed = new Set(changes.flatMap((c) => (c.type === 'remove' ? [c.id] : [])))
  return removed.size > 0 ? { ...canvas, edges: canvas.edges.filter((e) => !removed.has(e.id)) } : canvas
}

export function reconnectEdge(canvas: Canvas, edgeId: string, fromNode: string, toNode: string): Canvas {
  return {
    ...canvas,
    edges: canvas.edges.map((e) => (e.id === edgeId ? { ...e, fromNode, toNode } : e)),
  }
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

type NewNode = Pick<CanvasNode, 'type' | 'x' | 'y' | 'width' | 'height'> & { text?: string; file?: string }

function appendNode(canvas: Canvas, node: NewNode): Canvas {
  return { ...canvas, nodes: [...canvas.nodes, { id: newId(), ...node }] }
}

export function addTextCard(canvas: Canvas, at: { x: number; y: number }): Canvas {
  return appendNode(canvas, {
    type: 'text',
    x: Math.round(at.x),
    y: Math.round(at.y),
    ...FALLBACK_SIZE,
    text: '',
  })
}

export function addFileCard(canvas: Canvas, at: { x: number; y: number }, file: string): Canvas {
  return appendNode(canvas, {
    type: 'file',
    x: Math.round(at.x),
    y: Math.round(at.y),
    ...FALLBACK_SIZE,
    file,
  })
}

export function connectNodes(canvas: Canvas, fromNode: string, toNode: string): Canvas {
  return { ...canvas, edges: [...canvas.edges, { id: newId(), fromNode, toNode }] }
}

export function setEdgeLabel(canvas: Canvas, edgeId: string, label: string): Canvas {
  return {
    ...canvas,
    edges: canvas.edges.map((e) => {
      if (e.id !== edgeId) return e
      const { label: _previous, ...rest } = e
      return label === '' ? rest : { ...rest, label }
    }),
  }
}

export function setNodeText(canvas: Canvas, nodeId: string, text: string): Canvas {
  return { ...canvas, nodes: canvas.nodes.map((n) => (n.id === nodeId ? markEdited(n, text) : n)) }
}
