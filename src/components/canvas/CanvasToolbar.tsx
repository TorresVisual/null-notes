import { FilePlus, Focus, Lock, LockOpen, Maximize, Redo2, StickyNote, Undo2 } from 'lucide-react'

interface CanvasToolbarProps {
  locked: boolean
  canUndo: boolean
  canRedo: boolean
  status: string
  onUndo: () => void
  onRedo: () => void
  onFit: () => void
  onFitSelection: () => void
  onToggleLock: () => void
  onAddText: () => void
  onAddFile: () => void
}

export function CanvasToolbar(props: CanvasToolbarProps) {
  const { locked } = props
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas">
      <button className="toolbar-button" onClick={props.onUndo} disabled={!props.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
        <Undo2 size={14} />
      </button>
      <button className="toolbar-button" onClick={props.onRedo} disabled={!props.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
        <Redo2 size={14} />
      </button>
      <span className="canvas-toolbar-sep" />
      <button className="toolbar-button" onClick={props.onFit} title="Fit view (Shift+1)" aria-label="Fit view">
        <Maximize size={14} />
      </button>
      <button className="toolbar-button" onClick={props.onFitSelection} title="Fit selection (Shift+2)" aria-label="Fit selection">
        <Focus size={14} />
      </button>
      <button
        className={`toolbar-button${locked ? ' active' : ''}`}
        onClick={props.onToggleLock}
        title={locked ? 'Unlock canvas' : 'Lock canvas'}
        aria-label={locked ? 'Unlock canvas' : 'Lock canvas'}
        aria-pressed={locked}
      >
        {locked ? <Lock size={14} /> : <LockOpen size={14} />}
      </button>
      {!locked && (
        <>
          <span className="canvas-toolbar-sep" />
          <button className="toolbar-button" onClick={props.onAddText} title="Add text card" aria-label="Add text card">
            <StickyNote size={14} />
          </button>
          <button className="toolbar-button" onClick={props.onAddFile} title="Add file card" aria-label="Add file card">
            <FilePlus size={14} />
          </button>
        </>
      )}
      <span className="canvas-status" aria-live="polite">{props.status}</span>
    </div>
  )
}
