import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Previewer } from 'pagedjs'
import { buildPageCss, formatPrintDate } from '../lib/printPreviewCss'

interface UsePrintPreviewResult {
  containerRef: RefObject<HTMLDivElement>
  showPageNumber: boolean
  setShowPageNumber: (value: boolean) => void
  showTitle: boolean
  setShowTitle: (value: boolean) => void
  showDate: boolean
  setShowDate: (value: boolean) => void
  isRendering: boolean
  error: string | null
}

// Re-rendering on every keystroke-speed checkbox toggle would thrash
// Paged.js's real layout pass; this waits for toggling to settle first.
const RERENDER_DEBOUNCE_MS = 250

/**
 * Clones `contentEl` and paginates it through Paged.js into whatever
 * element `containerRef` is attached to, re-running whenever a checkbox
 * or the content changes. See docs/specs/better-printing-design.md's
 * "Real pagination via Paged.js" for why this replaces WebView2's native
 * (all-or-nothing) header/footer.
 */
export function usePrintPreview(contentEl: HTMLElement | null, noteTitle: string): UsePrintPreviewResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showPageNumber, setShowPageNumber] = useState(false)
  const [showTitle, setShowTitle] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [isRendering, setIsRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!contentEl || !container) return

    const styleEl = document.createElement('style')
    styleEl.textContent = buildPageCss({
      showPageNumber,
      showTitle,
      showDate,
      title: noteTitle,
      date: formatPrintDate(new Date()),
    })
    document.head.appendChild(styleEl)

    let cancelled = false
    setIsRendering(true)
    setError(null)
    const timer = setTimeout(() => {
      container.innerHTML = ''
      const clone = contentEl.cloneNode(true) as HTMLElement
      new Previewer()
        .preview(clone, [], container)
        .then(() => {
          if (!cancelled) setIsRendering(false)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setIsRendering(false)
          setError(e instanceof Error ? e.message : String(e))
        })
    }, RERENDER_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.head.removeChild(styleEl)
    }
  }, [contentEl, showPageNumber, showTitle, showDate, noteTitle])

  return {
    containerRef,
    showPageNumber,
    setShowPageNumber,
    showTitle,
    setShowTitle,
    showDate,
    setShowDate,
    isRendering,
    error,
  }
}
