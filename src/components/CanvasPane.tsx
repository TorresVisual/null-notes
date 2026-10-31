import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ReactFlowProvider } from '@xyflow/react'
import { useCanvas } from '../hooks/useCanvas'
import { ConflictBar } from './ConflictBar'
import { CanvasView } from './canvas/CanvasView'

interface CanvasPaneProps {
  path: string
}

const SAVE_LABELS = { clean: '', dirty: 'Unsaved…', saving: 'Saving…', error: 'Save failed' } as const

// Mount with key={path}: useCanvas is bound to one file for its lifetime.
export function CanvasPane({ path }: CanvasPaneProps) {
  const canvas = useCanvas(path)
  const [locked, setLocked] = useState(false)

  return (
    <div className="canvas-pane">
      {canvas.error && (
        <div className="conflict-bar" role="alert">
          <AlertTriangle size={14} />
          <span>{canvas.error} The canvas is read-only so the file is never overwritten.</span>
        </div>
      )}
      {canvas.conflict && (
        <ConflictBar
          message="This canvas changed on disk in a way that clashes with your edit."
          onKeepMine={canvas.keepMine}
          onReloadTheirs={canvas.reloadTheirs}
        />
      )}
      {canvas.canvas && (
        <ReactFlowProvider>
          <CanvasView
            path={path}
            canvas={canvas.canvas}
            readOnly={canvas.readOnly}
            locked={locked}
            saveLabel={SAVE_LABELS[canvas.saveState]}
            canUndo={canvas.canUndo}
            canRedo={canvas.canRedo}
            onChange={canvas.update}
            onUndo={canvas.undo}
            onRedo={canvas.redo}
            onToggleLock={() => setLocked((l) => !l)}
          />
        </ReactFlowProvider>
      )}
    </div>
  )
}
