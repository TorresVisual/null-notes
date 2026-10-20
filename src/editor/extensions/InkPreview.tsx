import { useCallback, useEffect, useRef, useState } from 'react'
import { InkEditorOverlay } from '../../ink/InkEditorOverlay'
import { inkDataToSvg } from '../../ink/svgSerialiser'
import { inkApi } from '../../lib/ink'
import { sanitizeNoteHtml } from '../../lib/sanitizeHtml'
import { pendingInkOpens } from '../toolbar/insertInk'
import type { InkData } from '../../ink/types'

const PREVIEW_MAX_HEIGHT = 320

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
  const [data, setData] = useState<InkData | null>(null)
  const [editing, setEditing] = useState(false)
  const latestRead = useRef(0)

  // Reads can resolve out of order when saves land close together, so only the
  // newest request is allowed to write the result.
  const refresh = useCallback(() => {
    const id = ++latestRead.current
    void inkApi.read(src).then((next) => {
      if (id === latestRead.current) setData(next)
    })
  }, [src])

  useEffect(() => {
    refresh()
  }, [refresh])

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
  const scale = Math.min(1, PREVIEW_MAX_HEIGHT / pageHeight)

  return (
    <>
      <div className={`ink-preview${editable ? ' editable' : ''}`} onClick={open}>
        {isEmpty(data) ? (
          <div className="ink-preview-empty">Empty drawing — click to draw</div>
        ) : (
          <div
            className="ink-preview-page"
            style={{ width: pageWidth * scale, aspectRatio: `${pageWidth} / ${pageHeight}` }}
            // The sidecar is a file in a workspace that can be shared or synced — the
            // same trust boundary as a note's own .md, so it gets the same sanitizing
            // pass DiagramBlock gives its SVG.
            dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(inkDataToSvg(data as InkData)) }}
          />
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
