import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'
import { api } from '../../lib/tauri'
import { useInkStore } from '../../store/ink'
import { DEFAULT_PENS } from '../../ink/pens'
import type { InkData } from '../../ink/types'

const read = vi.fn<(path: string) => Promise<InkData | null>>()
const write = vi.fn<(path: string, data: InkData) => Promise<void>>()

vi.mock('../../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: (path: string) => read(path),
    write: (path: string, data: InkData) => write(path, data),
  },
}))

const FENCE = '```pdf-page\n{"src":"/ws/N.pdf/page-0.png","width":600,"height":800}\n```'
const OUTSIDE_STROKE = {
  id: 'out',
  points: [
    { x: -50, y: -50, pressure: 0.5 },
    { x: -20, y: -10, pressure: 0.5 },
  ],
  color: '#000000',
  size: 4,
  opacity: 1,
}
const INK: InkData = {
  originX: -90,
  originY: -90,
  width: 800,
  height: 1000,
  strokes: [OUTSIDE_STROKE],
  shapes: [],
  texts: [],
}

let editor: Editor | null = null

function TestEditor({ editable = true }: { editable?: boolean }) {
  const instance = useEditor({
    extensions: coreExtensions,
    content: FENCE,
    editable,
    onBeforeCreate: ({ editor: e }) => {
      e.storage.noteContext.notePath = '/ws/N.md'
    },
  })
  useEffect(() => {
    if (instance) editor = instance
  }, [instance])
  return <EditorContent editor={instance} />
}

beforeEach(() => {
  vi.spyOn(api.pdf, 'readPage').mockResolvedValue('AAAA')
  read.mockReset().mockResolvedValue(INK)
  write.mockReset().mockResolvedValue(undefined)
  useInkStore.setState({
    tool: 'text',
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
    textSize: 18,
    activeCanvas: null,
    activeCanvasId: null,
  })
})

afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
  vi.restoreAllMocks()
})

const overlay = () => document.querySelector('.ink-editor-overlay')

async function inkOverlayOf(container: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const el = container.querySelector<HTMLElement>('.pdf-page-ink')
    if (!el?.querySelector('svg')) throw new Error('ink overlay not mounted')
    return el
  })
}

describe('a PDF page with ink', () => {
  it('shows the drawing as an SVG overlay clipped to the page', async () => {
    const { container } = render(<TestEditor />)
    const ink = await inkOverlayOf(container)

    expect(ink.style.overflow).toBe('hidden')
    expect(ink.querySelector('canvas')).toBeNull()
  })

  it('maps the overlay onto the page rectangle even when the sidecar extent is larger', async () => {
    const { container } = render(<TestEditor />)
    const ink = await inkOverlayOf(container)

    expect(ink.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 600 800')
  })

  it('opens the full-screen editor with the page as backdrop on click', async () => {
    const { container } = render(<TestEditor />)
    await inkOverlayOf(container)

    fireEvent.click(container.querySelector('.pdf-page-block') as HTMLElement)

    await waitFor(() => expect(overlay()).not.toBeNull())
    const backdrop = document.querySelector<HTMLImageElement>('img[alt="Page backdrop"]')
    expect(backdrop?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(backdrop?.style.width).toBe('600px')
    expect(backdrop?.style.height).toBe('800px')
  })

  it('does not open the editor when the note is not editable', async () => {
    const { container } = render(<TestEditor editable={false} />)
    await inkOverlayOf(container)

    fireEvent.click(container.querySelector('.pdf-page-block') as HTMLElement)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(overlay()).toBeNull()
  })

  it('keeps ink outside the page, untouched, when the page is saved', async () => {
    const { container } = render(<TestEditor />)
    await inkOverlayOf(container)
    fireEvent.click(container.querySelector('.pdf-page-block') as HTMLElement)
    await waitFor(() => expect(overlay()).not.toBeNull())

    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    fireEvent.pointerDown(canvas, { pointerType: 'pen', pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerType: 'pen', pointerId: 1 })
    const label = await waitFor(() => {
      const el = document.querySelector('textarea.ink-text-editor')
      if (!el) throw new Error('label editor not open')
      return el as HTMLTextAreaElement
    })
    fireEvent.change(label, { target: { value: 'note' } })
    fireEvent.blur(label)

    await waitFor(() => expect(write).toHaveBeenCalled())
    expect(write.mock.calls[0]?.[1].strokes).toEqual([OUTSIDE_STROKE])
  })
})
