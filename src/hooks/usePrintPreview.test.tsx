import { useEffect, useRef, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { usePrintPreview } from './usePrintPreview'

// vi.hoisted lets the mock factory below (which vitest hoists above this
// file's imports) share this function reference, so each test can control
// what the mocked Previewer resolves/rejects with.
const previewMock = vi.hoisted(() => vi.fn())
// Paged.js's real teardown surface: stopping an in-flight flow, destroying
// the pages (which is what disconnects their ResizeObservers) and removing
// the <style> tags the Polisher appended to <head>.
const stopMock = vi.hoisted(() => vi.fn())
const removePagesMock = vi.hoisted(() => vi.fn())
const destroyMock = vi.hoisted(() => vi.fn())

vi.mock('pagedjs', () => ({
  // A plain arrow function can't be used with `new` — the hook constructs
  // this with `new Previewer()`, so the mock needs a real constructor.
  Previewer: vi.fn().mockImplementation(function MockPreviewer() {
    return {
      preview: previewMock,
      chunker: { stop: stopMock, removePages: removePagesMock },
      polisher: { destroy: destroyMock },
    }
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
  // Mirrors how Layout.tsx hands down `editorPaneRef` itself (not
  // `.current`) — usePrintPreview reads `.current` inside its own effect.
  const contentRef = useRef(contentEl)
  contentRef.current = contentEl
  const result = usePrintPreview(contentRef, noteTitle)
  onResult(result)
  return <div ref={result.containerRef} />
}

// Radix renders DialogContent through a portal, so the node `containerRef`
// attaches to does not exist on the commit that runs the hook's own effect.
// This reproduces that ordering: the container appears one commit late.
function PortalHarness({ contentEl, noteTitle, onResult }: HarnessProps) {
  const contentRef = useRef(contentEl)
  contentRef.current = contentEl
  const result = usePrintPreview(contentRef, noteTitle)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  onResult(result)
  return mounted ? <div ref={result.containerRef} /> : null
}

function makeContentEl(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'editor-pane'
  el.textContent = 'Note content'
  return el
}

beforeEach(() => {
  previewMock.mockResolvedValue({ total: 3 })
})

afterEach(() => {
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
    expect(previewMock).toHaveBeenCalledWith(
      expect.any(Node),
      [expect.objectContaining({ [window.location.href]: expect.stringContaining('@page') })],
      expect.any(HTMLDivElement),
    )
  })

  // Paged.js only scrapes the document's own stylesheets when the argument
  // is omitted entirely — and that path *deletes* them from the page. So the
  // @page rule has to travel as an argument; a <style> left in <head> reaches
  // neither Paged.js nor, safely, the real print job.
  it('hands the @page CSS to Paged.js instead of injecting it into <head>', async () => {
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={() => {}} />)

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))
    expect(document.head.querySelector('style')).toBeNull()
  })

  it('strips the clone\'s class so .editor-pane\'s screen-only sizing CSS never reaches Paged.js', async () => {
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={() => {}} />)

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))
    const [clonedContent] = previewMock.mock.calls[0] as [HTMLElement, string[], HTMLDivElement]
    expect(clonedContent.hasAttribute('class')).toBe(false)
  })

  it('re-renders with page-number CSS when showPageNumber is toggled on', async () => {
    let latest: ReturnType<typeof usePrintPreview> | undefined
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={(r) => { latest = r }} />)
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))

    act(() => {
      latest?.setShowPageNumber(true)
    })

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2))
    expect(previewMock).toHaveBeenLastCalledWith(
      expect.any(Node),
      [expect.objectContaining({ [window.location.href]: expect.stringContaining('counter(page)') })],
      expect.any(HTMLDivElement),
    )
  })

  // Every page a Previewer built keeps a ResizeObserver on its own wrapper.
  // Left connected while the next render empties the container, they fire
  // against pages whose content is gone and Paged.js throws
  // "Cannot read properties of null (reading 'nextSibling')".
  it('tears the previous Previewer down before re-rendering', async () => {
    let latest: ReturnType<typeof usePrintPreview> | undefined
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={(r) => { latest = r }} />)
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))
    expect(removePagesMock).not.toHaveBeenCalled()

    act(() => {
      latest?.setShowTitle(true)
    })

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2))
    expect(stopMock).toHaveBeenCalledTimes(1)
    expect(removePagesMock).toHaveBeenCalledTimes(1)
    expect(destroyMock).toHaveBeenCalledTimes(1)
  })

  // Regression: with an object ref this rendered nothing at all until some
  // unrelated re-render (ticking a checkbox) happened to retrigger the effect,
  // because nothing in the dependency list changes when the node attaches.
  it('renders once the container attaches, even if that is a commit late', async () => {
    render(<PortalHarness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={() => {}} />)

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))
  })

  it('surfaces a pagination failure as an error and clears isRendering', async () => {
    previewMock.mockRejectedValue(new Error('paged.js exploded'))
    let latest: ReturnType<typeof usePrintPreview> | undefined
    render(<Harness contentEl={makeContentEl()} noteTitle="Lecture 7" onResult={(r) => { latest = r }} />)

    await waitFor(() => expect(latest?.error).toBe("Couldn't prepare the print preview: paged.js exploded"))
    expect(latest?.isRendering).toBe(false)
  })
})
