import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { rememberPosition, recallPosition } from '../lib/notePositions'

/**
 * Keeps each note's scroll offset across tab switches. The editor unmounts
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
  // The listener effect below only attaches once, so it reads the current
  // mode from a ref that every render keeps fresh rather than from a stale
  // closure over the `viewMode` argument.
  const recordingMode = useRef(viewMode)
  recordingMode.current = viewMode

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const onScroll = () => {
      const path = recordingFor.current
      if (!path) return
      const field = recordingMode.current === 'raw' ? 'rawScrollTop' : 'scrollTop'
      rememberPosition(path, { [field]: element.scrollTop })
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return

    recordingFor.current = null
    if (!activeTab || isLoading) return

    const remembered = recallPosition(activeTab)
    const target = (viewMode === 'raw' ? remembered?.rawScrollTop : remembered?.scrollTop) ?? 0
    element.scrollTop = target
    // What actually stuck: a note whose KaTeX, Mermaid and images have not
    // sized themselves yet is shorter than its final height, so the browser
    // clamps the offset down.
    let applied = element.scrollTop
    recordingFor.current = activeTab

    if (applied === target) return

    // A single rAF retry isn't enough: Mermaid renders via an async promise
    // that can resolve many frames after mount, and images/KaTeX can keep
    // reflowing the pane for a while too. Watch the content for as long as it
    // keeps growing, nudging the offset back each time — but only while the
    // offset is still the clamped one, otherwise the user scrolled in the
    // meantime and yanking them back would be worse than landing short.
    const content = element.firstElementChild
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (element.scrollTop !== applied) {
        observer.disconnect()
        return
      }
      element.scrollTop = target
      applied = element.scrollTop
      if (applied === target) observer.disconnect()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [activeTab, isLoading, viewMode])

  return scrollRef
}
