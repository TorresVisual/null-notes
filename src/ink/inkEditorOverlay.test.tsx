import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react'
import { InkEditorOverlay } from './InkEditorOverlay'
import type { InkBackdrop } from './InkEditorOverlay'
import { useInkStore } from '../store/ink'
import type { CanvasHandle } from '../store/ink'
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

const SRC = '/ws/N.ink/a.svg'

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

function mount(backdrop?: InkBackdrop) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<InkEditorOverlay src={SRC} backdrop={backdrop} onSaved={onSaved} onClose={onClose} />)
  const overlay = document.querySelector<HTMLElement>('.ink-editor-overlay')
  if (!overlay) throw new Error('overlay not mounted')
  return { overlay, onClose, onSaved }
}

async function openLabel(text: string): Promise<HTMLTextAreaElement> {
  const canvas = document.querySelector('canvas')!
  fireEvent.pointerDown(canvas, { pointerType: 'pen', pointerId: 1 })
  fireEvent.pointerUp(canvas, { pointerType: 'pen', pointerId: 1 })
  const editor = await waitFor(() => {
    const el = document.querySelector('textarea.ink-text-editor')
    if (!el) throw new Error('editor not open')
    return el as HTMLTextAreaElement
  })
  fireEvent.change(editor, { target: { value: text } })
  return editor
}

function spyHandle(): CanvasHandle {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    deleteSelected: vi.fn(),
    hasSelection: false,
    toggleRuler: vi.fn(),
    rulerOn: false,
    zoom: 1,
    setZoom: vi.fn(),
    cropToContent: vi.fn(),
  }
}

describe('the full-screen ink editor', () => {
  it('renders into document.body and takes focus', () => {
    const { overlay } = mount()

    expect(overlay.parentElement).toBe(document.body)
    expect(document.activeElement).toBe(overlay)
  })

  it('shows the drawing tools straight away', async () => {
    mount()

    await screen.findByRole('button', { name: 'Fine' })
    expect(useInkStore.getState().activeCanvasId).toBe(SRC)
  })

  it('closes from Done', () => {
    const { onClose } = mount()

    fireEvent.click(screen.getByText('Done'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const { overlay, onClose } = mount()

    fireEvent.keyDown(overlay, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // The label editor's own Escape means "discard this label". If the overlay
  // also closed on it, one keypress would throw away the label *and* the page.
  it('does not close on the Escape that cancels a label being typed', async () => {
    const { onClose } = mount()
    const editor = await openLabel('half a thought')

    fireEvent.keyDown(editor, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('textarea.ink-text-editor')).toBeNull()
  })
})

describe('keyboard', () => {
  it('Ctrl+Z undoes the canvas and the key never reaches the page behind', async () => {
    const { overlay } = mount()
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    const editor = await openLabel('hello')
    fireEvent.blur(editor)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(overlay, { key: 'z', ctrlKey: true })

    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write.mock.calls[1]?.[1].texts).toHaveLength(0)
    expect(behind).not.toHaveBeenCalled()
    document.removeEventListener('keydown', behind)
  })

  it('Ctrl+Y and Ctrl+Shift+Z redo', async () => {
    const { overlay } = mount()
    const editor = await openLabel('hello')
    fireEvent.blur(editor)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(overlay, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))

    fireEvent.keyDown(overlay, { key: 'y', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3))
    expect(write.mock.calls[2]?.[1].texts).toHaveLength(1)

    fireEvent.keyDown(overlay, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledTimes(4))
    fireEvent.keyDown(overlay, { key: 'Z', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(write).toHaveBeenCalledTimes(5))
    expect(write.mock.calls[4]?.[1].texts).toHaveLength(1)
  })

  // Before the first stroke the slot can still belong to a canvas in the note.
  it('leaves another canvas alone when it owns the active slot', async () => {
    const { overlay } = mount()
    await waitFor(() => expect(useInkStore.getState().activeCanvasId).toBe(SRC))
    const other = spyHandle()
    useInkStore.getState().setActiveCanvas('/ws/N.ink/other.svg', other)

    fireEvent.keyDown(overlay, { key: 'z', ctrlKey: true })

    expect(other.undo).not.toHaveBeenCalled()
  })

  it('leaves Ctrl+Z inside the label editor to the textarea', async () => {
    mount()
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    const editor = await openLabel('hello')

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })

    expect(write).not.toHaveBeenCalled()
    expect(behind).not.toHaveBeenCalled()
    document.removeEventListener('keydown', behind)
  })
})

describe('draw ribbon in the overlay', () => {
  it('switches tools from the letter shortcuts', () => {
    const { overlay } = mount()

    fireEvent.keyDown(overlay, { key: 'e' })
    expect(useInkStore.getState().tool).toBe('eraser')
    fireEvent.keyDown(overlay, { key: 'L' })
    expect(useInkStore.getState().tool).toBe('lasso')
    fireEvent.keyDown(overlay, { key: 'p' })
    expect(useInkStore.getState().tool).toBe('pen')
    fireEvent.keyDown(overlay, { key: 't' })
    expect(useInkStore.getState().tool).toBe('text')
  })

  it('leaves the tool alone for chords', () => {
    const { overlay } = mount()

    fireEvent.keyDown(overlay, { key: 'e', ctrlKey: true })

    expect(useInkStore.getState().tool).toBe('text')
  })

  // `e` and `t` are in the word being typed.
  it('does not switch tools while a label is being typed', async () => {
    mount()
    const editor = await openLabel('start')

    fireEvent.keyDown(editor, { key: 'e' })

    expect(useInkStore.getState().tool).toBe('text')
  })

  it('does not switch tools while a flyout slider has focus', () => {
    useInkStore.setState({ tool: 'pen' })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))
    const slider = screen.getByLabelText('Pen thickness')

    fireEvent.keyDown(slider, { key: 'e' })

    expect(useInkStore.getState().tool).toBe('pen')
  })

  it('closes an open flyout on Escape without closing the overlay, then closes the overlay', () => {
    useInkStore.setState({ tool: 'pen' })
    const { overlay, onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))
    const slider = screen.getByLabelText('Pen thickness')

    fireEvent.keyDown(slider, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Pen thickness')).toBeNull()

    fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

interface Call {
  name: string
  args: unknown[]
}

function installRecordingContext(): Call[] {
  const calls: Call[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined
      if (prop in target) return target[prop]
      return (...args: unknown[]) => {
        calls.push({ name: prop, args })
      }
    },
    set: (target, prop, value) => {
      if (typeof prop === 'string') target[prop] = value
      return true
    },
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ctx) as unknown as HTMLCanvasElement['getContext'],
  )
  return calls
}

function mockViewport(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, width, height, toJSON: () => ({}) }) as DOMRect,
  )
}

// Each frame sets the device transform and then the world one, so the last
// setTransform is the camera: setTransform(scale, 0, 0, scale, -x * scale, -y * scale).
function paintedCamera(calls: Call[]): { scale: number; x: number; y: number } {
  const world = calls.filter((c) => c.name === 'setTransform').pop()
  if (!world) throw new Error('nothing painted yet')
  const [scale = 1, , , , tx = 0, ty = 0] = world.args as number[]
  return { scale, x: -tx / scale, y: -ty / scale }
}

describe('the camera in the overlay', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the world point under the cursor fixed on Ctrl+wheel', async () => {
    const calls = installRecordingContext()
    mockViewport(800, 600)
    mount()
    const surface = document.querySelector('.ink-canvas-wrap') as Element
    await waitFor(() => expect(paintedCamera(calls)).toMatchObject({ scale: 1, x: -400, y: -300 }))
    const before = paintedCamera(calls)
    const worldBefore = { x: 600 / before.scale + before.x, y: 100 / before.scale + before.y }

    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -400, clientX: 600, clientY: 100 })

    await waitFor(() => expect(paintedCamera(calls).scale).toBeGreaterThan(1))
    const after = paintedCamera(calls)
    expect(600 / after.scale + after.x).toBeCloseTo(worldBefore.x, 6)
    expect(100 / after.scale + after.y).toBeCloseTo(worldBefore.y, 6)
  })

  it('zooms with Ctrl + = and resets with Ctrl + 0', async () => {
    mockViewport(800, 600)
    const { overlay } = mount()
    await waitFor(() => expect(useInkStore.getState().activeCanvas).not.toBeNull())

    fireEvent.keyDown(overlay, { key: '=', ctrlKey: true })
    await waitFor(() => expect(useInkStore.getState().activeCanvas?.zoom).toBe(1.25))

    fireEvent.keyDown(overlay, { key: '0', ctrlKey: true })
    await waitFor(() => expect(useInkStore.getState().activeCanvas?.zoom).toBe(1))
  })
})

describe('page backdrop', () => {
  const backdrop: InkBackdrop = { dataUrl: 'data:image/png;base64,AAAA', width: 600, height: 800 }

  class LoadedImage {
    onload: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }

  beforeEach(() => vi.stubGlobal('Image', LoadedImage))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('paints the page image at its own size in ink coordinates', async () => {
    const calls = installRecordingContext()
    mount(backdrop)

    await waitFor(() => expect(calls.some((c) => c.name === 'drawImage')).toBe(true))
    const draw = calls.find((c) => c.name === 'drawImage')
    expect(draw?.args.slice(1)).toEqual([0, 0, 600, 800])
  })

  it('paints no backdrop without one', async () => {
    const calls = installRecordingContext()
    mount()

    await waitFor(() => expect(calls.some((c) => c.name === 'clearRect')).toBe(true))
    expect(calls.some((c) => c.name === 'drawImage')).toBe(false)
  })
})
