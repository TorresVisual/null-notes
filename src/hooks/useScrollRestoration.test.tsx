import { useRef } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useScrollRestoration } from './useScrollRestoration'
import { rememberPosition } from '../lib/notePositions'

// The bug this pins (#20): a note with async-laying-out content (Mermaid
// resolves its render as a promise, sometimes several frames after mount)
// needs more than one retry to land the restored offset. A fake
// ResizeObserver stands in for jsdom's, which never fires — this lets the
// test drive "content grew" events on its own schedule instead of a real
// layout engine's.
let observeCalls: Element[] = []
let fireResize: (() => void) | null = null

class FakeResizeObserver {
  constructor(callback: () => void) {
    fireResize = callback
  }
  observe(el: Element) {
    observeCalls.push(el)
  }
  disconnect() {
    fireResize = null
  }
}

interface HarnessProps {
  activeTab: string | null
  isLoading: boolean
  maxScroll: number
}

// jsdom has no layout engine, so scrollTop assignment is never clamped on
// its own. This patches the one element the hook touches to clamp against a
// test-controlled ceiling, standing in for "the browser clamps the offset
// down because the content isn't sized yet."
function Harness({ activeTab, isLoading, maxScroll }: HarnessProps) {
  const scrollRef = useScrollRestoration(activeTab, isLoading)
  // A ref (not the `maxScroll` prop directly) because the property below is
  // only defined once, on first mount — it needs a live value to read on
  // every later resize, not the value from the render that created it.
  const maxScrollRef = useRef(maxScroll)
  maxScrollRef.current = maxScroll
  return (
    <div
      ref={(el) => {
        if (el && !(el as unknown as { patched?: boolean }).patched) {
          ;(el as unknown as { patched: boolean }).patched = true
          let value = 0
          Object.defineProperty(el, 'scrollTop', {
            get: () => value,
            set: (v: number) => {
              value = Math.min(v, maxScrollRef.current)
            },
          })
        }
        scrollRef.current = el
      }}
    >
      <div />
    </div>
  )
}

afterEach(() => {
  cleanup()
  observeCalls = []
  fireResize = null
  vi.unstubAllGlobals()
})

describe('useScrollRestoration', () => {
  it('keeps retrying across multiple late-layout passes, not just one frame', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    rememberPosition('Retry.md', { scrollTop: 500 })

    const { rerender, container } = render(
      <Harness activeTab="Retry.md" isLoading={false} maxScroll={0} />,
    )
    const el = container.firstElementChild as HTMLElement
    // Nothing sized yet — the restore attempt clamps to 0, same as a real
    // browser would with an empty Mermaid/KaTeX placeholder.
    expect(el.scrollTop).toBe(0)
    expect(observeCalls).toHaveLength(1)

    // First late-layout pass grows the note, but not enough yet — a single
    // rAF retry would have already fired and missed this.
    rerender(<Harness activeTab="Retry.md" isLoading={false} maxScroll={200} />)
    fireResize?.()
    expect(el.scrollTop).toBe(200)

    // A second pass (e.g. Mermaid's render promise finally resolving)
    // finishes the growth — this is the retry a one-shot rAF can't reach.
    rerender(<Harness activeTab="Retry.md" isLoading={false} maxScroll={500} />)
    fireResize?.()
    expect(el.scrollTop).toBe(500)
  })

  it('stops nudging once the user scrolls away on their own', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    rememberPosition('UserScroll.md', { scrollTop: 500 })

    // Clamped short of the target, so the watch stays active — a note
    // already at its final size never needed the retry loop to begin with.
    const { container } = render(
      <Harness activeTab="UserScroll.md" isLoading={false} maxScroll={100} />,
    )
    const el = container.firstElementChild as HTMLElement
    expect(el.scrollTop).toBe(100)

    // The user scrolls for real, to somewhere the retry didn't put them.
    el.scrollTop = 42
    // A later growth pass must not yank them back to the restored offset.
    fireResize?.()

    expect(el.scrollTop).toBe(42)
  })
})
