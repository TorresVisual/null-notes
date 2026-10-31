import { useCallback, useMemo, useRef, type KeyboardEvent } from 'react'
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasFlow } from '../../hooks/useCanvasFlow'
import { useCanvasFileStatus } from '../../hooks/useCanvasFileStatus'
import { api } from '../../lib/tauri'
import { isSafeWorkspacePath, type Canvas } from '../../lib/jsonCanvas'
import { workspaceFilePath } from '../../lib/canvasPath'
import type { FlowEdge, FlowNode } from '../../lib/canvasFlow'
import { promptText } from '../../store/promptDialog'
import { showToast } from '../../store/toast'
import { useWorkspaceStore } from '../../store/workspace'
import { CanvasActionsContext, type CanvasActions } from './canvasActions'
import { canvasNodeTypes } from './canvasNodes'
import { CanvasToolbar } from './CanvasToolbar'

const FIT_PADDING = 0.15
const FIT_DURATION_MS = 200
const DELETE_KEYS = ['Backspace', 'Delete']
const MULTI_SELECT_KEYS = ['Shift', 'Meta', 'Control']

interface CanvasViewProps {
  path: string
  canvas: Canvas
  readOnly: boolean
  locked: boolean
  saveLabel: string
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
  const { fitView, getNodes, screenToFlowPosition } = useReactFlow<FlowNode, FlowEdge>()
  const flow = useCanvasFlow(canvas, props.onChange)
  const fileStatus = useCanvasFileStatus(workspace, path, canvas)

  const actions = useMemo<CanvasActions>(
    () => ({ locked, workspace, fileStatus, editText: flow.editText, deletePass: flow.removePass }),
    [locked, workspace, fileStatus, flow.editText, flow.removePass],
  )

  const centre = useCallback(() => {
    const rect = frame.current?.getBoundingClientRect()
    return screenToFlowPosition(
      rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 },
    )
  }, [screenToFlowPosition])

  const fitAll = useCallback(() => void fitView({ padding: FIT_PADDING, duration: FIT_DURATION_MS }), [fitView])

  const fitSelection = useCallback(() => {
    const selected = getNodes().filter((n) => n.selected)
    void fitView({ nodes: selected.length > 0 ? selected : undefined, padding: FIT_PADDING, duration: FIT_DURATION_MS })
  }, [fitView, getNodes])

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
          fitView
          colorMode="dark"
        >
          <Background />
          <Controls showInteractive={false} showFitView={false} />
        </ReactFlow>
      </div>
    </CanvasActionsContext.Provider>
  )
}
