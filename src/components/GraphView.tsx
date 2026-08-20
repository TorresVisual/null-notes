import { useEffect, useMemo, useState } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force'
import { X } from 'lucide-react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { api } from '../lib/tauri'
import { buildGraph } from '../lib/graph'
import type { GraphNode, GraphEdge } from '../lib/graph'
import type { GraphLink, GraphTag } from '../types'

interface GraphViewProps {
  onClose: () => void
}

interface SimNode extends GraphNode, SimulationNodeDatum {}

interface PositionedNode extends GraphNode {
  x: number
  y: number
}

interface PositionedEdge {
  source: PositionedNode
  target: PositionedNode
  kind: GraphEdge['kind']
}

// Runs the simulation to convergence synchronously (manual .tick(), no
// .on('tick') animation loop) so the graph renders once, fully settled —
// "stays responsive at a few hundred notes" means no per-frame React
// re-renders during layout, not a live physics animation.
function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]) {
  const simNodes: SimNode[] = nodes.map((n) => ({ ...n }))
  const simLinks: SimulationLinkDatum<SimNode>[] = edges.map((e) => ({ ...e }))

  const simulation = forceSimulation(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((d) => d.id)
        .distance(80)
        .strength(0.3),
    )
    .force('charge', forceManyBody().strength(-160))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide(28))
    .stop()

  for (let i = 0; i < 300; i++) simulation.tick()

  const positioned: PositionedNode[] = simNodes.map((n) => ({ id: n.id, title: n.title, x: n.x ?? 0, y: n.y ?? 0 }))
  const byId = new Map(positioned.map((n) => [n.id, n]))
  const positionedEdges: PositionedEdge[] = edges.flatMap((e) => {
    const source = byId.get(e.source)
    const target = byId.get(e.target)
    return source && target ? [{ source, target, kind: e.kind }] : []
  })

  const PADDING = 60
  const xs = positioned.map((n) => n.x)
  const ys = positioned.map((n) => n.y)
  const minX = (xs.length ? Math.min(...xs) : 0) - PADDING
  const minY = (ys.length ? Math.min(...ys) : 0) - PADDING
  const maxX = (xs.length ? Math.max(...xs) : 0) + PADDING
  const maxY = (ys.length ? Math.max(...ys) : 0) + PADDING
  const viewBox = `${minX} ${minY} ${Math.max(maxX - minX, 1)} ${Math.max(maxY - minY, 1)}`

  return { nodes: positioned, edges: positionedEdges, viewBox }
}

export function GraphView({ onClose }: GraphViewProps) {
  const notes = useNotesStore((s) => s.notes)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [links, setLinks] = useState<GraphLink[]>([])
  const [tags, setTags] = useState<GraphTag[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!workspacePath) return
    setIsLoading(true)
    Promise.all([api.notes.graphLinks(workspacePath), api.notes.graphTags(workspacePath)]).then(([l, t]) => {
      setLinks(l)
      setTags(t)
      setIsLoading(false)
    })
  }, [workspacePath])

  const { nodes: rawNodes, edges: rawEdges } = useMemo(() => buildGraph(notes, links, tags), [notes, links, tags])
  const { nodes, edges, viewBox } = useMemo(() => layoutGraph(rawNodes, rawEdges), [rawNodes, rawEdges])

  function open(path: string) {
    openTab(path)
    onClose()
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="graph-view" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Connections</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close connections graph" title="Close connections graph">
            <X size={16} />
          </button>
        </div>
        {isLoading ? (
          <p className="status">Loading…</p>
        ) : nodes.length === 0 ? (
          <p className="empty-state">
            No notes yet.
            <span className="empty-state-detail">
              This graphs [[wiki-links]] and shared #tags between notes — create a couple of notes
              and link or tag them to see connections here.
            </span>
          </p>
        ) : (
          <svg className="graph-svg" viewBox={viewBox} role="img" aria-label="Note connections graph">
            {edges.map((e) => (
              <line
                key={`${e.source.id}|${e.target.id}|${e.kind}`}
                className={`graph-edge graph-edge-${e.kind}`}
                x1={e.source.x}
                y1={e.source.y}
                x2={e.target.x}
                y2={e.target.y}
              />
            ))}
            {nodes.map((n) => (
              <g
                key={n.id}
                className="graph-node"
                onClick={() => open(n.id)}
                role="button"
                aria-label={`Open ${n.title}`}
              >
                <circle cx={n.x} cy={n.y} r={8} />
                <text x={n.x} y={n.y - 13} textAnchor="middle">
                  {n.title}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}
