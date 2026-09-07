import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTerminal } from './useTerminal'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    terminal: {
      open: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    },
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

// A minimal double for xterm.js — real Terminal instances need a canvas
// renderer jsdom doesn't provide. This hook's own sequencing logic (not
// xterm's rendering) is what's under test here.
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function FakeTerminal(this: Record<string, unknown>) {
    this.loadAddon = vi.fn()
    this.open = vi.fn()
    this.onData = vi.fn(() => ({ dispose: vi.fn() }))
    this.write = vi.fn()
    this.dispose = vi.fn()
    this.cols = 80
    this.rows = 24
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function FakeFitAddon(this: Record<string, unknown>) {
    this.fit = vi.fn()
  }),
}))

const terminal = vi.mocked(api.terminal)

function fakeContainerRef() {
  return { current: document.createElement('div') }
}

describe('useTerminal', () => {
  beforeEach(() => {
    class FakeResizeObserver {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  // The bug this pins: terminal_open spawns a real shell process and isn't
  // instantaneous. A write issued before it resolves — a fast click on the
  // insert-path button, in production — used to hit "no terminal session is
  // open" on the backend, silently, because nothing awaited the open call.
  it('does not write until the session has finished opening', async () => {
    let resolveOpen: () => void = () => {}
    terminal.open.mockReturnValue(new Promise<void>((resolve) => { resolveOpen = resolve }))

    const { result } = renderHook(() =>
      useTerminal(fakeContainerRef(), '/ws', '/ws/Note.md'),
    )

    result.current.insertText('/ws/Note.md')
    expect(terminal.write).not.toHaveBeenCalled()

    resolveOpen()
    await waitFor(() => expect(terminal.write).toHaveBeenCalledWith('/ws/Note.md'))
  })

  it('writes immediately once the session is already open', async () => {
    terminal.open.mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useTerminal(fakeContainerRef(), '/ws', '/ws/Note.md'),
    )
    await waitFor(() => expect(terminal.open).toHaveBeenCalled())

    result.current.insertText('/ws/Note.md')

    await waitFor(() => expect(terminal.write).toHaveBeenCalledWith('/ws/Note.md'))
  })
})
