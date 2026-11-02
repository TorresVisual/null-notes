import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { useResolvedAssetSrc } from '../hooks/useResolvedAssetSrc'
import { useRegionDrawing } from '../hooks/useRegionDrawing'
import type { OcclusionRect } from '../lib/occlusion'

interface OcclusionDialogProps {
  notePath: string
  src: string
  onConfirm: (rects: OcclusionRect[]) => void
  onClose: () => void
}

function percentStyle({ x, y, w, h }: OcclusionRect) {
  return { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }
}

export function OcclusionDialog({ notePath, src, onConfirm, onClose }: OcclusionDialogProps) {
  const { resolved, failed } = useResolvedAssetSrc(notePath, src)
  const { rects, draft, handlers, remove } = useRegionDrawing()
  const count = rects.length

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel occlusion-dialog" showCloseButton={false} aria-describedby={undefined}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Image occlusion cards</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="settings-panel-body">
          <p className="occlusion-hint">
            Drag over the image to mark a region to hide. Each region becomes its own card; click a region to remove it.
          </p>
          {failed && <span className="note-image-missing">Missing image: {src}</span>}
          {resolved && (
            <div className="occlusion-surface" data-testid="occlusion-surface" {...handlers}>
              <img src={resolved} alt="" draggable={false} />
              {rects.map((rect, index) => (
                <button
                  key={index}
                  type="button"
                  className="occlusion-region"
                  style={percentStyle(rect)}
                  aria-label={`Remove region ${index + 1}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={() => remove(index)}
                >
                  <span className="occlusion-region-number">{index + 1}</span>
                </button>
              ))}
              {draft && <span className="occlusion-region occlusion-region--draft" style={percentStyle(draft)} />}
            </div>
          )}
        </div>
        <div className="settings-panel-footer occlusion-actions">
          <button className="settings-reset" onClick={onClose}>
            Cancel
          </button>
          <button className="settings-reset occlusion-confirm" disabled={count === 0} onClick={() => onConfirm(rects)}>
            {count === 1 ? 'Create 1 card' : `Create ${count} cards`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
