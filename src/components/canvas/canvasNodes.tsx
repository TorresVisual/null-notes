import { memo, useContext, useState, type CSSProperties, type ReactNode } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Pencil, Trash2 } from 'lucide-react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { api } from '../../lib/tauri'
import { excerptForPreview } from '../../lib/notePreview'
import { elementColor, groupLabel, type FlowNode } from '../../lib/canvasFlow'
import { workspaceFilePath } from '../../lib/canvasPath'
import type { CanvasNode } from '../../lib/jsonCanvas'
import { noteTitle, useNotesStore } from '../../store/notes'
import { CanvasActionsContext } from './canvasActions'

const SIDES: Array<[string, Position]> = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
]

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

interface CardProps {
  node: CanvasNode
  selected: boolean
  kind: string
  inert?: boolean
  children: ReactNode
}

function Card({ node, selected, kind, inert, children }: CardProps) {
  const { locked } = useContext(CanvasActionsContext)
  const accent = elementColor(node)
  return (
    <div
      className={`canvas-card canvas-card--${kind}${node.pass !== undefined ? ' is-agent' : ''}${inert ? ' is-inert' : ''}`}
      style={accent ? ({ '--card-accent': accent } as CSSProperties) : undefined}
    >
      <NodeResizer isVisible={selected && !locked} minWidth={60} minHeight={30} />
      {SIDES.map(([id, position]) => (
        <Handle key={id} id={id} type="source" position={position} isConnectable={!locked} />
      ))}
      {node.edited === true && (
        <span className="canvas-edited" title="You edited this card">
          <Pencil size={10} />
        </span>
      )}
      {children}
    </div>
  )
}

export const CanvasTextNode = memo(function CanvasTextNode({ data, selected }: NodeProps<FlowNode>) {
  const { locked, editText } = useContext(CanvasActionsContext)
  const [draft, setDraft] = useState<string | null>(null)
  const { node } = data

  function commit() {
    if (draft !== null && draft !== text(node.text)) editText(node.id, draft)
    setDraft(null)
  }

  return (
    <Card node={node} selected={selected} kind="text">
      {draft === null ? (
        // ponytail: plain text, upgrade to a read-only Markdown render if agents' formatting needs it.
        <div
          className="canvas-text"
          onDoubleClick={() => {
            if (!locked) setDraft(text(node.text))
          }}
        >
          {text(node.text)}
        </div>
      ) : (
        <textarea
          className="canvas-text-edit nodrag nowheel"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDraft(null)
          }}
        />
      )}
    </Card>
  )
})

export const CanvasFileNode = memo(function CanvasFileNode({ data, selected }: NodeProps<FlowNode>) {
  const { workspace, fileStatus } = useContext(CanvasActionsContext)
  const notes = useNotesStore((s) => s.notes)
  const [excerpt, setExcerpt] = useState<string | null>(null)
  const { node } = data
  const file = text(node.file)
  const live = fileStatus[file] === true
  const isNote = file.endsWith('.md')
  const absolute = workspace && live ? workspaceFilePath(workspace, file) : null
  const line = typeof node.line === 'number' ? node.line : null

  function loadExcerpt() {
    if (!absolute || !workspace || !isNote || excerpt !== null) return
    api.notes
      .open(workspace, absolute)
      .then((content) => setExcerpt(excerptForPreview(content)))
      .catch(() => setExcerpt(''))
  }

  return (
    <Card node={node} selected={selected} kind="file" inert={!live}>
      <div className="canvas-file" title={excerpt || file} onMouseEnter={loadExcerpt}>
        <div className="canvas-file-title">{isNote && absolute ? noteTitle(notes, absolute) : file}</div>
        {line !== null && <div className="canvas-file-line">:{line}</div>}
        {!live && <div className="canvas-file-line">file not found</div>}
      </div>
    </Card>
  )
})

export const CanvasGroupNode = memo(function CanvasGroupNode({ data, selected }: NodeProps<FlowNode>) {
  const { locked, deletePass } = useContext(CanvasActionsContext)
  const { node } = data
  const pass = node.pass

  async function removePass() {
    if (pass === undefined) return
    if (await confirm(`Delete pass ${pass} and all of its cards? Cards you added yourself are kept.`)) deletePass(pass)
  }

  return (
    <Card node={node} selected={selected} kind="group">
      <div className="canvas-group-label">
        <span>{groupLabel(node)}</span>
        {pass !== undefined && !locked && (
          <button
            className="canvas-group-delete nodrag"
            onClick={() => void removePass()}
            aria-label={`Delete pass ${pass}`}
            title={`Delete pass ${pass}`}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </Card>
  )
})

export const CanvasLinkNode = memo(function CanvasLinkNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data
  return (
    <Card node={node} selected={selected} kind="link" inert>
      <div className="canvas-link-tag">web card</div>
      <div className="canvas-text">{text(node.url)}</div>
    </Card>
  )
})

export const CanvasUnknownNode = memo(function CanvasUnknownNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data
  return (
    <Card node={node} selected={selected} kind="unknown" inert>
      <div className="canvas-link-tag">{node.type}</div>
    </Card>
  )
})

export const canvasNodeTypes = {
  canvasText: CanvasTextNode,
  canvasFile: CanvasFileNode,
  canvasGroup: CanvasGroupNode,
  canvasLink: CanvasLinkNode,
  canvasUnknown: CanvasUnknownNode,
}
