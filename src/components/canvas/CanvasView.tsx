import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  getNodesBounds,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasFlow } from '../../hooks/useCanvasFlow'
import { useCanvasFileStatus } from '../../hooks/useCanvasFileStatus'
import { useCanvasViewport } from '../../hooks/useCanvasViewport'
import { api } from '../../lib/tauri'
import { isSafeWorkspacePath, passOf, type Canvas } from '../../lib/jsonCanvas'
import { workspaceFilePath } from '../../lib/canvasPath'
import { hiddenForLatestOnly, type FlowEdge, type FlowNode } from '../../lib/canvasFlow'
import { promptText } from '../../store/promptDialog'
import { showToast } from '../../store/toast'
import { useWorkspaceStore } from '../../store/workspace'
import { CanvasActionsContext, type CanvasActions } from './canvasActions'
import { canvasNodeTypes } from './canvasNodes'
import { CanvasToolbar } from './CanvasToolbar'
import { PassLegend } from './PassLegend'

const FIT_PADDING = 0.15
const FIT_DURATION_MS = 200
const PULSE_MS = 1500
const ARRIVAL_FIT_DELAY_MS = 80
const ARRIVAL_FIT_RETRIES = 5
const DELETE_KEYS = ['Backspace', 'Delete']
const MULTI_SELECT_KEYS = ['Shift', 'Meta', 'Control']

interface CanvasViewProps {
  path: string
  canvas: Canvas
  readOnly: boolean
  locked: boolean
  saveLabel: string
  appendedPasses: number[]
  canUndo: boolean
  canRedo: boolean
  onChange: (next: Canvas) => void
  onUndo: () => void
  onRedo: () => void
  onToggleLock: () => void
}

export function CanvasView(props: CanvasViewProps) {
  const { path, canvas, readOnly, onUndo, onRedo } = props
  const locked = props.locked || readOnly
  const workspace = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const frame = useRef<HTMLDivElement>(null)
  const { fitBounds, fitView, getNodes, screenToFlowPosition } = useReactFlow<FlowNode, FlowEdge>()
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set())
  const [pulsePass, setPulsePass] = useState<number | null>(null)
  const flow = useCanvasFlow(canvas, props.onChange, hidden)
  const viewport = useCanvasViewport(path)
  const passes = useMemo(
    () => [...new Set(canvas.nodes.flatMap((n) => passOf(n) ?? []))].sort((a, b) => a - b),
    [canvas.nodes],
  )
  const fileStatus = useCanvasFileStatus(workspace, path, canvas)

  const actions = useMemo<CanvasActions>(
    () => ({ locked, pulsePass, workspace, fileStatus, editText: flow.editText, deletePass: flow.removePass }),
    [locked, pulsePass, workspace, fileStatus, flow.editText, flow.removePass],
  )

  const centre = useCallback(() => {
    const rect = frame.current?.getBoundingClientRect()
    return screenToFlowPosition(
      rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 },
    )
  }, [screenToFlowPosition])

  const fitAll = useCallback(() => void fitView({ padding: FIT_PADDING, duration: FIT_DURATION_MS }), [fitView])

  // fitView waits on React Flow's own measuring pass, which never completes for cards
  // that just arrived; fitBounds applies at once from the sizes we already know.
  const fitNodes = useCallback(
    (nodes: FlowNode[]) => void fitBounds(getNodesBounds(nodes), { padding: FIT_PADDING, duration: FIT_DURATION_MS }),
    [fitBounds],
  )

  const fitSelection = useCallback(() => {
    const selected = getNodes().filter((n) => n.selected)
    if (selected.length > 0) fitNodes(selected)
    else fitAll()
  }, [fitAll, fitNodes, getNodes])

  const jumpToPass = useCallback(
    (pass: number) => {
      setHidden((h) => (h.has(pass) ? new Set([...h].filter((p) => p !== pass)) : h))
      // New or just-unhidden cards reach React Flow's store a render later.
      const attempt = (left: number) => {
        const nodes = getNodes().filter((n) => passOf(n.data.node) === pass)
        if (nodes.length > 0) fitNodes(nodes)
        else if (left > 0) setTimeout(() => attempt(left - 1), ARRIVAL_FIT_DELAY_MS)
      }
      setTimeout(() => attempt(ARRIVAL_FIT_RETRIES), ARRIVAL_FIT_DELAY_MS)
    },
    [fitNodes, getNodes],
  )

  const togglePass = useCallback(
    (pass: number) => setHidden((h) => new Set(h.has(pass) ? [...h].filter((p) => p !== pass) : [...h, pass])),
    [],
  )

  useEffect(() => {
    const newest = props.appendedPasses.at(-1)
    if (newest === undefined) return
    showToast(`Pass ${newest} added`)
    setPulsePass(newest)
    jumpToPass(newest)
    const clear = setTimeout(() => setPulsePass(null), PULSE_MS)
    return () => clearTimeout(clear)
  }, [props.appendedPasses, jumpToPass])

  async function addFile() {
    const file = (await promptText('File path in the workspace (e.g. src/net/retry.ts):'))?.trim()
    if (!file) return
    if (!isSafeWorkspacePath(file)) {
      showToast('File cards need a relative path inside the workspace.')
      return
    }
    flow.addFileCard(centre(), file)
  }

  async function editEdgeLabel(edge: FlowEdge) {
    if (locked) return
    const label = await promptText('Edge label:', edge.data?.edge.label ?? '')
    if (label !== null) flow.editEdgeLabel(edge.id, label.trim())
  }

  // Only a plain click opens the target; a modified click is a selection gesture.
  const openFileCard: NodeMouseHandler<FlowNode> = (event, node) => {
    const { node: card } = node.data
    if (card.type !== 'file' || typeof card.file !== 'string' || !workspace) return
    if (event.shiftKey || event.ctrlKey || event.metaKey || fileStatus[card.file] !== true) return
    if (card.file.endsWith('.md')) openTab(workspaceFilePath(workspace, card.file))
    else void api.notes.openInEditor(workspace, card.file, typeof card.line === 'number' ? card.line : null)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
    const mod = e.ctrlKey || e.metaKey
    if (e.shiftKey && e.code === 'Digit1') fitAll()
    else if (e.shiftKey && e.code === 'Digit2') fitSelection()
    else if (mod && e.code === 'KeyA') {
      e.preventDefault()
      flow.selectAll()
    } else if (mod && e.code === 'KeyZ') {
      e.preventDefault()
      if (e.shiftKey) onRedo()
      else onUndo()
    } else if (mod && e.code === 'KeyY') {
      e.preventDefault()
      onRedo()
    }
  }

  return (
    <CanvasActionsContext.Provider value={actions}>
      <CanvasToolbar
        locked={locked}
        canUndo={props.canUndo && !readOnly}
        canRedo={props.canRedo && !readOnly}
        status={props.saveLabel}
        onUndo={onUndo}
        onRedo={onRedo}
        onFit={fitAll}
        onFitSelection={fitSelection}
        onToggleLock={props.onToggleLock}
        onAddText={() => flow.addTextCard(centre())}
        onAddFile={() => void addFile()}
      />
      <div className="canvas-flow" ref={frame} onKeyDown={onKeyDown}>
        <ReactFlow<FlowNode, FlowEdge>
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={canvasNodeTypes}
          onNodesChange={flow.onNodesChange}
          onEdgesChange={flow.onEdgesChange}
          onNodeDragStart={flow.onNodeDragStart}
          onNodeDrag={flow.onNodeDrag}
          onConnect={flow.onConnect}
          onReconnect={flow.onReconnect}
          onNodeClick={openFileCard}
          onEdgeDoubleClick={(_e, edge) => void editEdgeLabel(edge)}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={!locked}
          nodesConnectable={!locked}
          edgesReconnectable={!locked}
          deleteKeyCode={locked ? null : DELETE_KEYS}
          multiSelectionKeyCode={MULTI_SELECT_KEYS}
          minZoom={0.1}
          maxZoom={2}
          defaultViewport={viewport.initial}
          fitView={!viewport.initial}
          onMoveEnd={viewport.onMoveEnd}
          colorMode="dark"
        >
          <Background />
          <Controls showInteractive={false} showFitView={false} />
        </ReactFlow>
        <PassLegend
          passes={passes}
          hidden={hidden}
          onToggle={togglePass}
          onShowOnlyLatest={() => setHidden(hiddenForLatestOnly(passes))}
          onJump={jumpToPass}
        />
      </div>
    </CanvasActionsContext.Provider>
  )
}
