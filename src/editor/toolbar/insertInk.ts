import type { Editor } from '@tiptap/core'
import { inkApi } from '../../lib/ink'
import type { InkData } from '../../ink/types'

// Sized to the editor pane's content width (800px max-width less 48px padding
// a side) so the right edge is not clipped, and tall enough for a worked
// derivation rather than a couple of lines.
export const INK_WIDTH = 700
export const INK_HEIGHT = 900

const EMPTY_INK: InkData = { width: INK_WIDTH, height: INK_HEIGHT, strokes: [], shapes: [], texts: [] }

// Shared by the toolbar's own "Insert ink canvas" button and the native
// menu's "Insert Ink Block" item (routed through EditorToolbar's window-event
// listener) — both need the exact same sidecar-then-node sequence, and a
// second copy of it is how the two drift.
export async function insertInk(editor: Editor, notePath: string): Promise<void> {
  const dir = await inkApi.ensureDir(notePath)
  const sep = dir.includes('\\') ? '\\' : '/'
  const svgPath = `${dir}${sep}sketch-${Date.now()}.svg`
  await inkApi.write(svgPath, EMPTY_INK)
  editor.commands.insertContent({
    type: 'inkBlock',
    attrs: { src: svgPath, width: INK_WIDTH, height: INK_HEIGHT },
  })
}
