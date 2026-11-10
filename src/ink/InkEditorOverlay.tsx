import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { InkCanvas } from './InkCanvas'
import { DrawRibbon } from './DrawRibbon'
import { toolForShortcut } from './ribbonShortcuts'
import { zoomForKey } from './zoom'
import { useInkStore } from '../store/ink'

export interface InkBackdrop {
  dataUrl: string
  width: number
  height: number
}

interface InkEditorOverlayProps {
  src: string
  backdrop?: InkBackdrop
  onSaved: () => void
  onClose: () => void
}

export function InkEditorOverlay({ src, backdrop, onSaved, onClose }: InkEditorOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  // The note editor stays mounted behind this, so undo has to be answered here:
  // left alone it would silently edit the note under the drawing.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const key = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
      e.stopPropagation()
      // A label being typed keeps the textarea's own undo.
      if (e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      const { activeCanvas, activeCanvasId } = useInkStore.getState()
      if (!activeCanvas || activeCanvasId !== src) return
      if (key === 'y' || e.shiftKey) activeCanvas.redo()
      else activeCanvas.undo()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !(e.target instanceof HTMLTextAreaElement)) {
      const { activeCanvas, activeCanvasId } = useInkStore.getState()
      const next = activeCanvas && activeCanvasId === src ? zoomForKey(e.key, activeCanvas.zoom) : null
      if (next !== null && activeCanvas) {
        e.preventDefault()
        e.stopPropagation()
        activeCanvas.setZoom(next)
        return
      }
    }
    const tool = toolForShortcut(e)
    if (tool) {
      e.preventDefault()
      e.stopPropagation()
      useInkStore.getState().setTool(tool)
      return
    }
    // The label editor preventDefaults the Escape that cancels a label, so by the
    // time it bubbles here `defaultPrevented` means "already handled".
    if (e.key === 'Escape' && !e.defaultPrevented) onClose()
  }

  return createPortal(
    <div
      ref={rootRef}
      className="ink-editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Drawing editor"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="ink-editor-header">
        <DrawRibbon onDone={onClose} />
      </div>
      <div className="ink-editor-body">
        <InkCanvas svgPath={src} backdrop={backdrop} autoActivate onSaved={onSaved} />
      </div>
    </div>,
    document.body,
  )
}
