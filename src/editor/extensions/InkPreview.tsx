import { useEffect, useState } from 'react'
import { InkEditorOverlay } from '../../ink/InkEditorOverlay'
import { InkSvg } from '../../ink/InkSvg'
import { useInkSidecar } from '../../hooks/useInkSidecar'
import { pendingInkOpens } from '../toolbar/insertInk'
import type { InkData } from '../../ink/types'

const PREVIEW_MAX_HEIGHT = 320
// A tall, narrow page would otherwise shrink to an unreadable sliver; it keeps
// this much of its size and the block grows taller instead.
export const PREVIEW_MIN_SCALE = 0.6

export function previewScale(pageHeight: number): number {
  return Math.max(PREVIEW_MIN_SCALE, Math.min(1, PREVIEW_MAX_HEIGHT / pageHeight))
}

interface InkPreviewProps {
  src: string
  width: number
  height: number
  editable: boolean
}

function isEmpty(data: InkData | null): boolean {
  return !data || data.strokes.length + data.shapes.length + data.texts.length === 0
}

export function InkPreview({ src, width, height, editable }: InkPreviewProps) {
  const { data, refresh } = useInkSidecar(src)
  const [editing, setEditing] = useState(false)

  // insertInk dispatches this right after inserting a brand-new, empty drawing —
  // there is nothing to preview yet, so go straight to drawing. Matched on src so
  // only the block that was just inserted opens.
  useEffect(() => {
    if (!editable) return
    if (pendingInkOpens.delete(src)) setEditing(true)
    function onAutoOpen(event: Event) {
      if ((event as CustomEvent<{ src: string }>).detail.src !== src) return
      pendingInkOpens.delete(src)
      setEditing(true)
    }
    window.addEventListener('ink:auto-open', onAutoOpen)
    return () => window.removeEventListener('ink:auto-open', onAutoOpen)
  }, [src, editable])

  const open = editable ? () => setEditing(true) : undefined
  // The page's own size, not the node's: the page grows as you write, and the
  // node attrs keep the size it was inserted with.
  const pageWidth = data?.width ?? width
  const pageHeight = data?.height ?? height
  const scale = previewScale(pageHeight)

  return (
    <>
      <div className={`ink-preview${editable ? ' editable' : ''}`} onClick={open}>
        {isEmpty(data) ? (
          <div className="ink-preview-empty">Empty drawing — click to draw</div>
        ) : (
          <div
            className="ink-preview-page"
            style={{ width: pageWidth * scale, aspectRatio: `${pageWidth} / ${pageHeight}` }}
          >
            <InkSvg data={data as InkData} />
          </div>
        )}
        {editable && (
          <button type="button" className="diagram-block-edit ink-preview-edit" aria-label="Edit drawing" onClick={open}>
            Edit
          </button>
        )}
      </div>
      {editing && (
        <InkEditorOverlay
          src={src}
          width={width}
          height={height}
          onSaved={refresh}
          onClose={() => {
            setEditing(false)
            refresh()
          }}
        />
      )}
    </>
  )
}
