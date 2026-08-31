import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { usePrintPreview } from './usePrintPreview'

// vi.hoisted lets the mock factory below (which vitest hoists above this
// file's imports) share this function reference, so each test can control
// what the mocked Previewer resolves/rejects with.
const previewMock = vi.hoisted(() => vi.fn())

vi.mock('pagedjs', () => ({
  // A plain arrow function can't be used with `new` — the hook constructs
  // this with `new Previewer()`, so the mock needs a real constructor.
  Previewer: vi.fn().mockImplementation(function MockPreviewer() {
    return { preview: previewMock }
  }),
}))

interface HarnessProps {
  contentEl: HTMLElement | null
  noteTitle: string
  onResult: (result: ReturnType<typeof usePrintPreview>) => void
}

// A hook that returns a ref meant to be attached to a DOM node has to be
// exercised through a real render, not renderHook() in isolation — the ref
// needs to be attached during commit, before the hook's own effect runs,
// exactly like a real consumer (ExportPdfDialog/PrintDialog) does.
function Harness({ contentEl, noteTitle, onResult }: HarnessProps) {
  const result = usePrintPreview(contentEl, noteTitle)
  onResult(result)
  return <div ref={result.containerRef} />
}

function makeContentEl(): HTMLElement {
  const el = document.createElement('div')
  el.textContent = 'Note content'
  return el
}

beforeEach(() => {
  previewMock.mockResolvedValue({ total: 3 })
})

afterEach(() => {
  // Unmounting runs the hook's own effect cleanup (which removes the
  // <style> tag it created) — a manual DOM sweep here would race with
  // that and remove the node out from under it.
  cleanup()
  vi.clearAllMocks()
})

describe('usePrintPreview', () => {
  it('does nothing without a content element', () => {
    render(<Harness contentEl={null} noteTitle="Lecture 7" onResult={() => {}} />)
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('renders the preview once a content element is provided', async () => {
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={() => {}} />)

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))
    expect(previewMock).toHaveBeenCalledWith(expect.any(Node), [], expect.any(HTMLDivElement))
  })

  it('re-renders with page-number CSS when showPageNumber is toggled on', async () => {
    let latest: ReturnType<typeof usePrintPreview> | undefined
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={(r) => { latest = r }} />)
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))

    act(() => {
      latest?.setShowPageNumber(true)
    })

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2))
    const injectedStyle = document.head.querySelector('style')
    expect(injectedStyle?.textContent).toContain('counter(page)')
  })

  it('surfaces a pagination failure as an error and clears isRendering', async () => {
    previewMock.mockRejectedValue(new Error('paged.js exploded'))
    let latest: ReturnType<typeof usePrintPreview> | undefined
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={(r) => { latest = r }} />)

    await waitFor(() => expect(latest?.error).toBe('paged.js exploded'))
    expect(latest?.isRendering).toBe(false)
  })
})
