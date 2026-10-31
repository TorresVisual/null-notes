export interface CanvasNode {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  pass?: number
  author?: 'agent'
  edited?: boolean
  text?: unknown
  file?: unknown
  line?: unknown
  label?: unknown
  color?: unknown
  [extra: string]: unknown
}

export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  label?: string
  pass?: number
  author?: 'agent'
  [extra: string]: unknown
}

export interface Canvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  lastPass: number
  [extra: string]: unknown
}

export type ParseResult = { ok: true; canvas: Canvas } | { ok: false; error: string }

export type CanvasColor =
  | { kind: 'preset'; index: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'hex'; value: string }

const PASS_COLORS = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isElement(value: unknown): value is Record<string, unknown> & { id: string } {
  return isRecord(value) && typeof value.id === 'string'
}

function maxPass(elements: readonly { pass?: number }[]): number {
  return elements.reduce((max, el) => (typeof el.pass === 'number' ? Math.max(max, el.pass) : max), 0)
}

export function parseCanvas(raw: string): ParseResult {
  if (raw.trim() === '') return { ok: true, canvas: { nodes: [], edges: [], lastPass: 0 } }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!isRecord(data)) return { ok: false, error: 'Canvas root must be a JSON object' }

  const { nodes = [], edges = [], lastPass, ...rest } = data
  if (!Array.isArray(nodes) || !nodes.every(isElement)) {
    return { ok: false, error: '"nodes" must be an array of objects with an id' }
  }
  if (!Array.isArray(edges) || !edges.every(isElement)) {
    return { ok: false, error: '"edges" must be an array of objects with an id' }
  }

  const typedNodes = nodes as CanvasNode[]
  const typedEdges = edges as CanvasEdge[]
  return {
    ok: true,
    canvas: {
      ...rest,
      nodes: typedNodes,
      edges: typedEdges,
      lastPass: typeof lastPass === 'number' ? lastPass : Math.max(maxPass(typedNodes), maxPass(typedEdges)),
    },
  }
}

export function serializeCanvas(canvas: Canvas): string {
  const { nodes, edges, lastPass, ...rest } = canvas
  return JSON.stringify({ nodes, edges, lastPass, ...rest }, null, 2) + '\n'
}

export function passColorIndex(pass: number): number {
  return ((((pass - 1) % PASS_COLORS) + PASS_COLORS) % PASS_COLORS) + 1
}

export function membersOf(canvas: Canvas, groupId: string): CanvasNode[] {
  const group = canvas.nodes.find((n) => n.id === groupId)
  if (!group) return []
  return canvas.nodes.filter(
    (n) =>
      n !== group &&
      n.x >= group.x &&
      n.y >= group.y &&
      n.x + n.width <= group.x + group.width &&
      n.y + n.height <= group.y + group.height,
  )
}

export function deletePass(canvas: Canvas, pass: number): Canvas {
  const nodes = canvas.nodes.filter((n) => n.pass !== pass)
  const removed = new Set(canvas.nodes.filter((n) => n.pass === pass).map((n) => n.id))
  const edges = canvas.edges.filter(
    (e) => e.pass !== pass && !removed.has(e.fromNode) && !removed.has(e.toNode),
  )
  return { ...canvas, nodes, edges }
}

export function markEdited(node: CanvasNode, text: string): CanvasNode {
  const changed = node.pass !== undefined && node.text !== text
  return changed ? { ...node, text, edited: true } : { ...node, text }
}

export function resolveColor(value: unknown): CanvasColor | null {
  if (typeof value !== 'string') return null
  if (/^[1-6]$/.test(value)) return { kind: 'preset', index: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 }
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return { kind: 'hex', value }
  return null
}

export function edgeEnds(edge: CanvasEdge): { from: 'none' | 'arrow'; to: 'none' | 'arrow' } {
  return {
    from: edge.fromEnd === 'arrow' ? 'arrow' : 'none',
    to: edge.toEnd === 'none' ? 'none' : 'arrow',
  }
}

export function isSafeWorkspacePath(path: string): boolean {
  if (path === '' || /^[\\/]/.test(path) || /^[a-zA-Z]:/.test(path)) return false
  return path.split(/[\\/]/).every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}
