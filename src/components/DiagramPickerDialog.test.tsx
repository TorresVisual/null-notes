import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import { DiagramPickerDialog } from './DiagramPickerDialog'
import { diagramApi } from '../lib/diagram'
import { insertDiagram } from '../editor/toolbar/insertDiagram'

vi.mock('../lib/diagram', () => ({
  diagramApi: {
    ensureDir: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
  },
}))

vi.mock('../editor/toolbar/insertDiagram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../editor/toolbar/insertDiagram')>()
  return { ...actual, insertDiagram: vi.fn().mockResolvedValue(undefined) }
})

interface DiagramBlockContent {
  type: 'diagramBlock'
  attrs: { jsonSrc: string; svgSrc: string; width: number; height: number }
}

function makeEditor() {
  const chain = {
    focus: vi.fn(() => chain),
    deleteRange: vi.fn(() => chain),
    insertContent: vi.fn((_content: DiagramBlockContent) => chain),
    run: vi.fn(() => chain),
  }
  const editor = {
    chain: vi.fn(() => chain),
    storage: { noteContext: { notePath: '/ws/Note.md' } },
  } as unknown as Editor
  return { editor, chain }
}

const EXISTING = { jsonPath: '/ws/Lecture 7.diagrams/diagram-1.excalidraw', svgPath: '/ws/Lecture 7.diagrams/diagram-1.svg', noteTitle: 'Lecture 7' }

beforeEach(() => {
  vi.mocked(diagramApi.ensureDir).mockResolvedValue('/ws/Note.diagrams')
  vi.mocked(diagramApi.read).mockImplementation((path: string) => Promise.resolve(`content of ${path}`))
  vi.mocked(diagramApi.write).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DiagramPickerDialog', () => {
  it('inserts a brand-new diagram and closes when "New diagram" is picked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { editor } = makeEditor()
    render(<DiagramPickerDialog editor={editor} range={null} diagrams={[EXISTING]} onClose={onClose} />)

    await user.click(screen.getByText('New diagram'))

    expect(insertDiagram).toHaveBeenCalledWith(editor, '/ws/Note.md')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reuses the same files, with no read/write, when "Reuse" is picked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { editor, chain } = makeEditor()
    render(<DiagramPickerDialog editor={editor} range={null} diagrams={[EXISTING]} onClose={onClose} />)

    await user.click(screen.getByText('Lecture 7'))
    await user.click(screen.getByText('Reuse'))

    expect(diagramApi.read).not.toHaveBeenCalled()
    expect(diagramApi.write).not.toHaveBeenCalled()
    expect(chain.insertContent).toHaveBeenCalledWith({
      type: 'diagramBlock',
      attrs: { jsonSrc: EXISTING.jsonPath, svgSrc: EXISTING.svgPath, width: 700, height: 500 },
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('copies the sidecar files into this note when "Duplicate" is picked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { editor, chain } = makeEditor()
    render(<DiagramPickerDialog editor={editor} range={null} diagrams={[EXISTING]} onClose={onClose} />)

    await user.click(screen.getByText('Lecture 7'))
    await user.click(screen.getByText('Duplicate into this note'))

    expect(diagramApi.ensureDir).toHaveBeenCalledWith('/ws/Note.md')
    expect(diagramApi.read).toHaveBeenCalledWith(EXISTING.jsonPath)
    expect(diagramApi.read).toHaveBeenCalledWith(EXISTING.svgPath)
    expect(diagramApi.write).toHaveBeenCalledTimes(2)
    expect(chain.insertContent).toHaveBeenCalledTimes(1)
    const attrs = chain.insertContent.mock.calls[0]![0].attrs
    expect(attrs.jsonSrc).not.toBe(EXISTING.jsonPath)
    expect(attrs.jsonSrc).toMatch(/^\/ws\/Note\.diagrams[/\\]diagram-\d+\.excalidraw$/)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
