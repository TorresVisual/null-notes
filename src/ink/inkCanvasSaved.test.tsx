import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { InkCanvas, scrollAncestors } from './InkCanvas'
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
afterEach(cleanup)

function tap(canvas: Element) {
  fireEvent.pointerDown(canvas, { pointerType: 'pen', pointerId: 1 })
  fireEvent.pointerUp(canvas, { pointerType: 'pen', pointerId: 1 })
}

async function openEditor(container: HTMLElement): Promise<HTMLTextAreaElement> {
  tap(container.querySelector('canvas')!)
  return waitFor(() => {
    const el = container.querySelector('textarea.ink-text-editor')
    if (!el) throw new Error('editor not open')
    return el as HTMLTextAreaElement
  })
}

describe('onSaved', () => {
  it('fires after a committed edit has been written', async () => {
    const onSaved = vi.fn()
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} onSaved={onSaved} />)
    const editor = await openEditor(container)

    fireEvent.change(editor, { target: { value: 'hello' } })
    fireEvent.blur(editor)

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('does not fire until the write has resolved', async () => {
    let resolveWrite: () => void = () => {}
    write.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveWrite = resolve }))
    const onSaved = vi.fn()
    const { container } = render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} onSaved={onSaved} />)
    const editor = await openEditor(container)

    fireEvent.change(editor, { target: { value: 'hello' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(write).toHaveBeenCalled())
    expect(onSaved).not.toHaveBeenCalled()

    resolveWrite()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it('fires for the flush of a label still open when the canvas unmounts', async () => {
    const onSaved = vi.fn()
    const { container, unmount } = render(
      <InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} onSaved={onSaved} />,
    )
    const editor = await openEditor(container)
    fireEvent.change(editor, { target: { value: 'unfinished' } })

    unmount()

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(write.mock.calls[0]?.[1].texts[0]?.text).toBe('unfinished')
  })
})

describe('autoActivate', () => {
  it('registers the canvas on mount, without a pointer press', async () => {
    render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} autoActivate />)

    await waitFor(() => expect(useInkStore.getState().activeCanvasId).toBe('/ws/N.ink/a.svg'))
    expect(useInkStore.getState().activeCanvas).not.toBeNull()
  })

  it('stays unregistered without the flag', async () => {
    render(<InkCanvas svgPath="/ws/N.ink/a.svg" width={700} height={400} />)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useInkStore.getState().activeCanvasId).toBeNull()
  })
})

describe('scrollAncestors', () => {
  function withScroll(el: HTMLElement) {
    Object.defineProperty(el, 'scrollTop', { value: 100, writable: true })
    Object.defineProperty(el, 'scrollLeft', { value: 100, writable: true })
    return el
  }

  it('pans the overlay body on both axes, opposite to the drag', () => {
    const body = withScroll(document.createElement('div'))
    body.className = 'ink-editor-body'
    const inner = document.createElement('div')
    body.appendChild(inner)

    scrollAncestors(inner, 10, 20)

    expect(body.scrollTop).toBe(80)
    expect(body.scrollLeft).toBe(90)
  })

  it('still pans the note column vertically when there is no overlay', () => {
    const page = withScroll(document.createElement('div'))
    page.className = 'editor-scroll'
    const inner = document.createElement('div')
    page.appendChild(inner)

    scrollAncestors(inner, 10, 20)

    expect(page.scrollTop).toBe(80)
    expect(page.scrollLeft).toBe(100)
  })
})
