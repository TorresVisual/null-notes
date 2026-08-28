import type { Editor } from '@tiptap/core'
import { diagramApi } from '../../lib/diagram'

export const DIAGRAM_WIDTH = 700
export const DIAGRAM_HEIGHT = 500

const EMPTY_SCENE_JSON = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'null-notes',
  elements: [],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
})

const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'

// Shared by the toolbar's "Insert diagram" button and the slash command —
// both need the exact same sidecar-then-node sequence, matching insertInk's
// own reasoning for having one copy of this instead of two that could drift.
export async function insertDiagram(editor: Editor, notePath: string): Promise<void> {
  const dir = await diagramApi.ensureDir(notePath)
  const sep = dir.includes('\\') ? '\\' : '/'
  const id = Date.now()
  const jsonSrc = `${dir}${sep}diagram-${id}.excalidraw`
  const svgSrc = `${dir}${sep}diagram-${id}.svg`
  await diagramApi.write(jsonSrc, EMPTY_SCENE_JSON)
  await diagramApi.write(svgSrc, EMPTY_SVG)
  editor.commands.insertContent({
    type: 'diagramBlock',
    attrs: { jsonSrc, svgSrc, width: DIAGRAM_WIDTH, height: DIAGRAM_HEIGHT },
  })
  // A brand-new diagram has nothing worth previewing yet — open straight
  // into the editor instead of landing on an empty static block.
  window.dispatchEvent(new CustomEvent('diagram:auto-open', { detail: { jsonSrc } }))
}
