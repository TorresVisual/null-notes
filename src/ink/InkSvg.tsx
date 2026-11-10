import { inkDataToSvg } from './svgSerialiser'
import { sanitizeNoteHtml } from '../lib/sanitizeHtml'
import type { InkData } from './types'

export function InkSvg({ data }: { data: InkData }) {
  return (
    <div
      className="ink-svg"
      // The sidecar is a file in a workspace that can be shared or synced — the
      // same trust boundary as a note's own .md, so it gets the same sanitizing
      // pass DiagramBlock gives its SVG.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(inkDataToSvg(data)) }}
    />
  )
}
