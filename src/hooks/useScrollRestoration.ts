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
      if (path) rememberPosition(path, { scrollTop: element.scrollTop })
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return

    recordingFor.current = null
    if (!activeTab || isLoading) return

    const target = recallPosition(activeTab)?.scrollTop ?? 0
    element.scrollTop = target
    // What actually stuck: a note whose KaTeX, Mermaid and images have not
    // sized themselves yet is shorter than its final height, so the browser
    // clamps the offset down.
    const applied = element.scrollTop
    recordingFor.current = activeTab

    if (applied === target) return

    // Retry once the late content has laid out, but only if the offset is
    // still the clamped one — otherwise the user scrolled in the meantime and
    // yanking them back would be worse than landing short.
    const frame = requestAnimationFrame(() => {
      if (element.scrollTop === applied) element.scrollTop = target
    })
    return () => cancelAnimationFrame(frame)
  }, [activeTab, isLoading])

  return scrollRef
}
