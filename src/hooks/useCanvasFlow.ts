import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react'
import {
  addFileCard,
  addTextCard,
  applyEdgeFlowChanges,
  applyFlowChanges,
  connectNodes,
  reconnectEdge,
  setEdgeLabel,
  setNodeText,
  toFlow,
  type FlowEdge,
  type FlowNode,
} from '../lib/canvasFlow'
import { deletePass, membersOf, type Canvas } from '../lib/jsonCanvas'

type Point = { x: number; y: number }

function keepSelection<T extends { id: string; selected?: boolean }>(fresh: T[], previous: T[]): T[] {
  const selected = new Set(previous.filter((p) => p.selected).map((p) => p.id))
  return fresh.map((f) => (selected.has(f.id) ? { ...f, selected: true } : f))
}

/**
 * React Flow keeps its own copy of positions and selection so a drag is live;
 * the canvas is only edited when a drag or resize settles, so one gesture is
 * one undo step.
 */
export function useCanvasFlow(canvas: Canvas, onChange: (next: Canvas) => void) {
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlow(canvas).nodes)
  const [edges, setEdges] = useState<FlowEdge[]>(() => toFlow(canvas).edges)
  const canvasRef = useRef(canvas)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const groupDrag = useRef<{ id: string; origin: Point; members: Map<string, Point> } | null>(null)

  canvasRef.current = canvas

  useEffect(() => {
    const fresh = toFlow(canvas)
    setNodes((prev) => (nodesRef.current = keepSelection(fresh.nodes, prev)))
    setEdges((prev) => (edgesRef.current = keepSelection(fresh.edges, prev)))
  }, [canvas])

  // Several changes can land in one tick (delete a card, then its edges); each
  // must build on the previous result, not on the last render's canvas.
  const commit = useCallback(
    (edit: (current: Canvas) => Canvas) => {
      const next = edit(canvasRef.current)
      if (next === canvasRef.current) return
      canvasRef.current = next
      onChange(next)
    },
    [onChange],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const applied = applyNodeChanges(changes, nodesRef.current)
      nodesRef.current = applied
      setNodes(applied)

      const settledMoves = new Set<string>()
      const settledResizes = new Set<string>()
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false) settledMoves.add(c.id)
        if (c.type === 'dimensions' && c.resizing === false) settledResizes.add(c.id)
      }
      const edits: NodeChange[] = changes.filter((c) => c.type === 'remove')
      for (const n of applied) {
        if (settledMoves.has(n.id) || settledResizes.has(n.id)) {
          edits.push({ type: 'position', id: n.id, position: n.position })
        }
        const width = n.measured?.width ?? n.width
        const height = n.measured?.height ?? n.height
        if (settledResizes.has(n.id) && width !== undefined && height !== undefined) {
          edits.push({ type: 'dimensions', id: n.id, dimensions: { width, height }, resizing: false, setAttributes: true })
        }
      }
      if (edits.length > 0) commit((current) => applyFlowChanges(current, edits))
    },
    [commit],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      const applied = applyEdgeChanges(changes, edgesRef.current)
      edgesRef.current = applied
      setEdges(applied)
      const removals = changes.filter((c) => c.type === 'remove')
      if (removals.length > 0) commit((current) => applyEdgeFlowChanges(current, removals))
    },
    [commit],
  )

  const onNodeDragStart = useCallback<OnNodeDrag<FlowNode>>((_event, node) => {
    if (node.data.node.type !== 'group') {
      groupDrag.current = null
      return
    }
    const alreadyDragging = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id))
    const members = membersOf(canvasRef.current, node.id).filter((m) => !alreadyDragging.has(m.id))
    groupDrag.current = {
      id: node.id,
      origin: { ...node.position },
      members: new Map(members.map((m) => [m.id, { x: m.x, y: m.y }])),
    }
  }, [])

  const onNodeDrag = useCallback<OnNodeDrag<FlowNode>>((_event, node) => {
    const drag = groupDrag.current
    if (!drag || drag.id !== node.id) return
    const dx = node.position.x - drag.origin.x
    const dy = node.position.y - drag.origin.y
    const moved = nodesRef.current.map((n) => {
      const start = drag.members.get(n.id)
      return start ? { ...n, position: { x: start.x + dx, y: start.y + dy } } : n
    })
    nodesRef.current = moved
    setNodes(moved)
  }, [])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        commit((current) => connectNodes(current, connection.source, connection.target))
      }
    },
    [commit],
  )

  const onReconnect = useCallback(
    (previous: FlowEdge, connection: Connection) => {
      commit((current) => reconnectEdge(current, previous.id, connection.source, connection.target))
    },
    [commit],
  )

  const selectAll = useCallback(() => {
    const all = nodesRef.current.map((n) => ({ ...n, selected: true }))
    nodesRef.current = all
    setNodes(all)
  }, [])

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onNodeDragStart,
    onNodeDrag,
    onConnect,
    onReconnect,
    selectAll,
    addTextCard: useCallback((at: Point) => commit((c) => addTextCard(c, at)), [commit]),
    addFileCard: useCallback((at: Point, file: string) => commit((c) => addFileCard(c, at, file)), [commit]),
    editText: useCallback((id: string, text: string) => commit((c) => setNodeText(c, id, text)), [commit]),
    editEdgeLabel: useCallback((id: string, label: string) => commit((c) => setEdgeLabel(c, id, label)), [commit]),
    removePass: useCallback((pass: number) => commit((c) => deletePass(c, pass)), [commit]),
  }
}
