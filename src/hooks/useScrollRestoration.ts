import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { rememberPosition, recallPosition } from '../lib/notePositions'

function scrollFractionOf(element: HTMLElement): number {
  const scrollable = element.scrollHeight - element.clientHeight
  return scrollable > 0 ? element.scrollTop / scrollable : 0
}

/**
 * Keeps each note's scroll position across tab switches and, since the
 * rendered and raw views have completely different heights, across toggling
 * between the two — both read and write a 0..1 fraction of the scrollable
 * height rather than a pixel offset, so the two views land at the same
 * relative depth instead of literally the same pixel. The editor unmounts
 * while the next note loads, so the offset cannot live in component state.
 */
export function useScrollRestoration(
  activeTab: string | null,
  isLoading: boolean,
  viewMode: 'wysiwyg' | 'raw',
): RefObject<HTMLDivElement | null> {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Which note the scroll listener is currently recording for. Held in a ref
  // rather than the effect's closure so a scroll event that lands mid-switch
  // cannot write the outgoing note's offset under the incoming note's key.
  const recordingFor = useRef<string | null>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const onScroll = () => {
      const path = recordingFor.current
      if (path) rememberPosition(path, { scrollFraction: scrollFractionOf(element) })
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return

    recordingFor.current = null
    if (!activeTab || isLoading) return

    const fraction = recallPosition(activeTab)?.scrollFraction ?? 0
    // Recomputed (not captured once) because the retry loop below runs while
    // the scrollable height is still growing — the pixel offset for a fixed
    // fraction moves as that height does.
    const computeTarget = () => {
      const scrollable = element.scrollHeight - element.clientHeight
      return scrollable > 0 ? Math.round(fraction * scrollable) : 0
    }

    let applied = computeTarget()
    element.scrollTop = applied
    applied = element.scrollTop
    recordingFor.current = activeTab

    // A fraction of 0 always resolves to the top no matter how the content's
    // height changes afterward, so there is nothing further to watch.
    if (fraction === 0) return

    // A single rAF retry isn't enough: Mermaid renders via an async promise
    // that can resolve many frames after mount, and images/KaTeX can keep
    // reflowing the pane for a while too — each pass grows the scrollable
    // height, so the same fraction keeps mapping to a larger pixel offset.
    // Recompute and reapply on every resize, but bail the moment the user's
    // own scroll disagrees with what was last set here — yanking them back
    // would be worse than leaving them wherever they scrolled to.
    const content = element.firstElementChild
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (element.scrollTop !== applied) {
        observer.disconnect()
        return
      }
      applied = computeTarget()
      element.scrollTop = applied
      applied = element.scrollTop
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [activeTab, isLoading, viewMode])

  return scrollRef
}
