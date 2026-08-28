import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Editor } from '@tiptap/core'
import { insertDiagram, DIAGRAM_WIDTH, DIAGRAM_HEIGHT } from './insertDiagram'

const ensureDir = vi.fn()
const write = vi.fn()

vi.mock('../../lib/diagram', () => ({
  diagramApi: {
    ensureDir: (...args: unknown[]) => ensureDir(...args),
    write: (...args: unknown[]) => write(...args),
  },
}))

describe('insertDiagram', () => {
  beforeEach(() => {
    ensureDir.mockReset().mockResolvedValue('/ws/N.diagrams')
    write.mockReset().mockResolvedValue(undefined)
  })

  it('ensures the sidecar dir, writes both empty sidecar files, and inserts a diagramBlock node', async () => {
    const insertContent = vi.fn()
    const editor = { commands: { insertContent } } as unknown as Editor
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    await insertDiagram(editor, '/ws/Note.md')

    expect(ensureDir).toHaveBeenCalledWith('/ws/Note.md')
    expect(write).toHaveBeenCalledTimes(2)
    // toHaveBeenCalledTimes(2) above is the runtime guarantee TS can't see.
    const [jsonCall, svgCall] = write.mock.calls as [unknown[], unknown[]]
    expect(jsonCall[0]).toMatch(/^\/ws\/N\.diagrams\/diagram-\d+\.excalidraw$/)
    expect(svgCall[0]).toMatch(/^\/ws\/N\.diagrams\/diagram-\d+\.svg$/)

    expect(insertContent).toHaveBeenCalledWith({
      type: 'diagramBlock',
      attrs: {
        jsonSrc: jsonCall[0],
        svgSrc: svgCall[0],
        width: DIAGRAM_WIDTH,
        height: DIAGRAM_HEIGHT,
      },
    })

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'diagram:auto-open' }))
  })
})
