import type { Editor } from '@tiptap/core'
import { formatOcclusionTitle } from '../lib/occlusion'
import type { OcclusionRect } from '../lib/occlusion'

// One paragraph per region, each holding just the image: that serialises to a
// single `![alt](src "occlude=…")` line, which is exactly one card (see
// `parse_occlusion_line`, notes.rs). The regions share `src`, which is what
// keeps them tied to one diagram; no other link between them is stored.
export function insertOcclusionCards(
  editor: Editor,
  at: number,
  src: string,
  alt: string,
  rects: OcclusionRect[],
): void {
  const content = rects.map((rect) => ({
    type: 'paragraph',
    content: [{ type: 'image', attrs: { src, alt, title: formatOcclusionTitle('occlude', rect) } }],
  }))
  editor.chain().insertContentAt(at, content).run()
}
