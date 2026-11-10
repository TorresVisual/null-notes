import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { InkCanvas } from './InkCanvas'
import { useInkStore } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { InkData } from './types'

const write = vi.fn<(path: string, data: InkData) => Promise<void>>().mockResolvedValue(undefined)

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: () => Promise.resolve(null),
    write: (path: string, data: InkData) => write(path, data),
  },
}))

beforeEach(() => {
  write.mockClear()
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
afterEach(cleanup)

// jsdom never computes a real offsetX/offsetY (no layout engine), so every
// dispatched pointer event lands at (0, 0) regardless of clientX/clientY —
// coordinate-dependent flows (drag distance, exact placement) are left to
// e2e for that reason, the same posture the rest of this hook's pointer
// handling already has (see useInkCanvas.test.ts). What's tested here is the
// state wiring: tap opens an editor, typing and blurring commits it, and a
// second tap on the same spot reopens the item that's sitting there instead
// of stacking a new one on top.
function tap(canvas: Element, pointerId = 1) {
  fireEvent.pointerDown(canvas, { pointerType: 'pen', pointerId, clientX: 0, clientY: 0 })
  fireEvent.pointerUp(canvas, { pointerType: 'pen', pointerId, clientX: 0, clientY: 0 })
}

async function waitForEditor(container: HTMLElement): Promise<HTMLTextAreaElement> {
  return waitFor(() => {
    const el = container.querySelector('textarea.ink-text-editor')
    if (!el) throw new Error('editor not open')
    return el as HTMLTextAreaElement
  })
}

describe('the ink text tool', () => {
  it('tapping empty canvas with the text tool opens an editor', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    tap(container.querySelector('canvas')!)

    await waitForEditor(container)
  })

  it('typing and blurring commits the text to the sidecar and closes the editor', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    tap(container.querySelector('canvas')!)
    const editor = await waitForEditor(container)

    fireEvent.change(editor, { target: { value: 'hello' } })
    fireEvent.blur(editor)

    await waitFor(() => expect(write).toHaveBeenCalled())
    const [, data] = write.mock.calls[write.mock.calls.length - 1]!
    expect(data.texts).toHaveLength(1)
    expect(data.texts[0]).toMatchObject({ text: 'hello', size: 18 })
    expect(container.querySelector('textarea.ink-text-editor')).toBeNull()
  })

  it('committing an empty edit adds nothing', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    tap(container.querySelector('canvas')!)
    const editor = await waitForEditor(container)

    fireEvent.blur(editor)

    expect(write).not.toHaveBeenCalled()
  })

  it('pressing Escape discards the draft without writing', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    tap(container.querySelector('canvas')!)
    const editor = await waitForEditor(container)

    fireEvent.change(editor, { target: { value: 'discard me' } })
    fireEvent.keyDown(editor, { key: 'Escape' })

    expect(container.querySelector('textarea.ink-text-editor')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('pressing Enter commits without inserting a newline', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    tap(container.querySelector('canvas')!)
    const editor = await waitForEditor(container)

    fireEvent.change(editor, { target: { value: 'one line' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    await waitFor(() => expect(write).toHaveBeenCalled())
    expect(write.mock.calls[0]![1].texts[0]?.text).toBe('one line')
  })

  // Tapping the item a second time (no drag in between) reopens it for
  // editing instead of stacking a fresh label on top of it.
  it('tapping an existing item again reopens it for editing, pre-filled', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    const canvas = container.querySelector('canvas')!
    tap(canvas)
    let editor = await waitForEditor(container)
    fireEvent.change(editor, { target: { value: 'first' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))

    tap(canvas)
    editor = await waitForEditor(container)

    expect(editor.value).toBe('first')
  })

  // Editing an existing item down to nothing removes it — the only delete
  // path a text item has, since neither the lasso nor the eraser reach in.
  it('editing an existing item to empty removes it', async () => {
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" />)
    const canvas = container.querySelector('canvas')!
    tap(canvas)
    let editor = await waitForEditor(container)
    fireEvent.change(editor, { target: { value: 'first' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))

    tap(canvas)
    editor = await waitForEditor(container)
    fireEvent.change(editor, { target: { value: '' } })
    fireEvent.blur(editor)

    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write.mock.calls[1]![1].texts).toHaveLength(0)
  })
})
