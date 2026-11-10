import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'
import { useInkStore } from '../../store/ink'
import { DEFAULT_PENS } from '../../ink/pens'
import type { InkData } from '../../ink/types'
import { pendingInkOpens } from '../toolbar/insertInk'

const read = vi.fn<(path: string) => Promise<InkData | null>>()
const write = vi.fn<(path: string, data: InkData) => Promise<void>>()

vi.mock('../../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: (path: string) => read(path),
    write: (path: string, data: InkData) => write(path, data),
  },
}))

const SRC = '/ws/N.ink/a.svg'
const EMPTY: InkData = { originX: 0, originY: 0, width: 700, height: 400, strokes: [], shapes: [], texts: [] }
const WITH_LINE: InkData = {
  ...EMPTY,
  shapes: [{ id: 's1', kind: 'line', x1: 10, y1: 10, x2: 200, y2: 120, color: '#000000', size: 2 }],
}
const PREVIEW_FENCE = '```ink\n{"src":"/ws/N.ink/a.svg","width":700,"height":400}\n```'
const INLINE_FENCE = '```ink\n{"src":"/ws/N.ink/a.svg","width":700,"height":400,"inline":true}\n```'

let editor: Editor | null = null

function TestEditor({ content, editable = true }: { content: string; editable?: boolean }) {
  const instance = useEditor({ extensions: coreExtensions, content, editable })
  useEffect(() => {
    if (instance) editor = instance
  }, [instance])
  return <EditorContent editor={instance} />
}

beforeEach(() => {
  read.mockReset().mockResolvedValue(EMPTY)
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
})

const overlay = () => document.querySelector('.ink-editor-overlay')

async function previewOf(container: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const el = container.querySelector<HTMLElement>('.ink-preview')
    if (!el) throw new Error('preview not mounted')
    return el
  })
}

async function typeLabel(text: string): Promise<HTMLTextAreaElement> {
  const canvas = document.querySelector('canvas')!
  fireEvent.pointerDown(canvas, { pointerType: 'pen', pointerId: 1 })
  fireEvent.pointerUp(canvas, { pointerType: 'pen', pointerId: 1 })
  const textarea = await waitFor(() => {
    const el = document.querySelector('textarea.ink-text-editor')
    if (!el) throw new Error('editor not open')
    return el as HTMLTextAreaElement
  })
  fireEvent.change(textarea, { target: { value: text } })
  return textarea
}

// A React node view has to render a NodeViewWrapper; ReactNodeViewRenderer
// throws "Please use the NodeViewWrapper component for your node view" from
// its own `get dom()` otherwise.
describe('mounting an ink block in a real React editor', () => {
  it('renders a legacy inline block as a preview, keeping the flag in the markdown', async () => {
    const { container } = render(<TestEditor content={INLINE_FENCE} />)

    await waitFor(() => expect(container.querySelector('[data-node-view-wrapper]')).not.toBeNull())
    await previewOf(container)
    expect(container.querySelector('canvas.ink-canvas')).toBeNull()
    expect(container.querySelector('.ink-canvas-wrap')).toBeNull()
    const storage = editor?.storage as unknown as { markdown: { getMarkdown: () => string } }
    expect(storage.markdown.getMarkdown()).toContain('#ink=700x400,inline')
  })

  it('renders a block without the flag as a preview, not a canvas', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)

    await previewOf(container)
    expect(container.querySelector('.ink-canvas-wrap')).toBeNull()
    expect(overlay()).toBeNull()
  })

  it('shows a placeholder for an empty drawing', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)

    await previewOf(container)
    await screen.findByText('Empty drawing — click to draw')
  })

  it('shows a placeholder, not an error, when the sidecar cannot be read', async () => {
    read.mockResolvedValue(null)
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)

    await previewOf(container)
    await screen.findByText('Empty drawing — click to draw')
  })

  it('renders the whole page as a sanitized SVG once there is ink', async () => {
    read.mockResolvedValue(WITH_LINE)
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)

    await waitFor(() => expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull())
    expect(container.querySelector('.ink-preview-empty')).toBeNull()
  })
})

describe('opening the full-screen editor', () => {
  it('opens from a click on the preview, and closes from Done', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))

    await waitFor(() => expect(overlay()).not.toBeNull())
    fireEvent.click(screen.getByText('Done'))

    await waitFor(() => expect(overlay()).toBeNull())
    expect(container.querySelector('.ink-preview')).not.toBeNull()
  })

  it('opens from the Edit button', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    await previewOf(container)

    fireEvent.click(screen.getByLabelText('Edit drawing'))

    await waitFor(() => expect(overlay()).not.toBeNull())
  })

  it('closes on Escape, but not on the Escape that cancels a label', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())

    const textarea = await typeLabel('half')
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(overlay()).not.toBeNull()

    fireEvent.keyDown(overlay()!, { key: 'Escape' })
    await waitFor(() => expect(overlay()).toBeNull())
  })

  it('keeps the block and sidecar when closed without drawing', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())

    fireEvent.click(screen.getByText('Done'))

    await waitFor(() => expect(overlay()).toBeNull())
    expect(write).not.toHaveBeenCalled()
    expect(container.querySelector('.ink-preview')).not.toBeNull()
  })

  // insertInk can run before the node view's listener exists; the request must not be lost.
  it('opens a block that mounts after its auto-open was requested', async () => {
    pendingInkOpens.add(SRC)
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)

    await previewOf(container)
    await waitFor(() => expect(overlay()).not.toBeNull())
    expect(pendingInkOpens.has(SRC)).toBe(false)
  })

  it('opens when ink:auto-open names this block, and ignores other blocks', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    await previewOf(container)

    window.dispatchEvent(new CustomEvent('ink:auto-open', { detail: { src: '/ws/N.ink/other.svg' } }))
    expect(overlay()).toBeNull()

    window.dispatchEvent(new CustomEvent('ink:auto-open', { detail: { src: SRC } }))
    await waitFor(() => expect(overlay()).not.toBeNull())
  })
})

// Review Focus 5: a read-only note shows its drawings but cannot edit them.
describe('a note that is not editable', () => {
  it('has no Edit button and ignores clicks and auto-open', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} editable={false} />)
    const preview = await previewOf(container)

    expect(screen.queryByLabelText('Edit drawing')).toBeNull()
    fireEvent.click(preview)
    window.dispatchEvent(new CustomEvent('ink:auto-open', { detail: { src: SRC } }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(overlay()).toBeNull()
  })
})

describe('keeping the preview current', () => {
  it('re-reads the sidecar when the overlay reports a save', async () => {
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())
    read.mockResolvedValue(WITH_LINE)

    const textarea = await typeLabel('hello')
    fireEvent.blur(textarea)

    await waitFor(() => expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull())
  })

  // Review Focus 3: Done pressed while a label is still open. The text is saved
  // by useInkCanvas's unmount flush, which lands *after* the overlay is gone.
  it('refreshes when the write from a label left open on Done resolves', async () => {
    let resolveWrite: () => void = () => {}
    write.mockImplementation(() => new Promise<void>((resolve) => { resolveWrite = resolve }))
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())
    await typeLabel('unfinished')

    fireEvent.click(screen.getByText('Done'))
    await waitFor(() => expect(overlay()).toBeNull())
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const readsBeforeWrite = read.mock.calls.length
    read.mockResolvedValue(WITH_LINE)

    resolveWrite()

    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(readsBeforeWrite))
    await waitFor(() => expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull())
  })

  // Review Focus 4: a slow early read must not overwrite a newer one.
  it('keeps the newest data when reads resolve out of order', async () => {
    let resolveFirst: (data: InkData | null) => void = () => {}
    read.mockReset()
    read.mockImplementationOnce(() => new Promise<InkData | null>((resolve) => { resolveFirst = resolve }))
    read.mockResolvedValue(WITH_LINE)
    const { container } = render(<TestEditor content={PREVIEW_FENCE} />)
    fireEvent.click(await previewOf(container))
    await waitFor(() => expect(overlay()).not.toBeNull())

    const textarea = await typeLabel('hello')
    fireEvent.blur(textarea)
    await waitFor(() => expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull())

    resolveFirst(EMPTY)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(container.querySelector('.ink-preview-page svg line')).not.toBeNull()
    expect(container.querySelector('.ink-preview-empty')).toBeNull()
  })
})
