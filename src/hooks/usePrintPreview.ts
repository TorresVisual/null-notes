import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { Previewer } from 'pagedjs'
import { buildPageCss, formatPrintDate } from '../lib/printPreviewCss'
import { teardown, withPrintMount } from '../lib/printMount'

/** Paged.js keeps a placeholder copy of the top-level node's own tag/class
 *  around while it splits content across pages. Left as `.editor-pane`,
 *  that placeholder inherits its screen-only `max-width`/`margin: 0
 *  auto`/padding, which — measured against Paged.js's internal multi-column
 *  layout rather than one page — blows its width out to several page-widths
 *  and corrupts the pagination. The class does nothing useful once Paged.js
 *  owns layout, so it's dropped from the clone before handing it off. */
function cloneForPagination(el: HTMLElement): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement
  clone.removeAttribute('class')
  return clone
}

interface UsePrintPreviewResult {
  /** A *callback* ref, not an object ref. `DialogContent` renders through a
   *  Radix portal, whose children commit after this hook's own effect has
   *  already run — an object ref would still read `null` on that first pass,
   *  and nothing in the dependency list changes when the node later attaches,
   *  so the preview would never render until an unrelated re-render (ticking
   *  a checkbox) happened to retrigger the effect. */
  containerRef: (node: HTMLDivElement | null) => void
  showPageNumber: boolean
  setShowPageNumber: (value: boolean) => void
  showTitle: boolean
  setShowTitle: (value: boolean) => void
  showDate: boolean
  setShowDate: (value: boolean) => void
  isRendering: boolean
  error: string | null
  /** Paginates the note again into a bare `#print-root` and runs `run` while
   *  only that is visible — the one place Export and Print get their pages. */
  printPages: <T>(run: () => Promise<T>) => Promise<T>
}

// Re-rendering on every keystroke-speed checkbox toggle would thrash
// Paged.js's real layout pass; this waits for toggling to settle first.
const RERENDER_DEBOUNCE_MS = 250

/**
 * Clones `contentRef.current` and paginates it through Paged.js into
 * whatever element `containerRef` is attached to, re-running whenever a
 * checkbox or the content changes. See docs/specs/better-printing-design.md's
 * "Real pagination via Paged.js" for why this replaces WebView2's native
 * (all-or-nothing) header/footer.
 *
 * Takes the ref itself, not `.current`, and reads it inside the effect
 * rather than as a dependency: `Layout.tsx` opens this dialog in the same
 * state update that switches from raw to wysyiwyg view, which (re)mounts
 * `.editor-pane` in that same commit. A `.current` value read during that
 * render (e.g. passed down as a prop) would still be last render's stale
 * value — refs only update *during* commit, not before. Reading it inside
 * this effect, which runs after commit, always sees the freshly mounted node.
 */
export function usePrintPreview(
  contentRef: RefObject<HTMLElement | null>,
  noteTitle: string,
): UsePrintPreviewResult {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [showPageNumber, setShowPageNumber] = useState(false)
  const [showTitle, setShowTitle] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [isRendering, setIsRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contentVersion, setContentVersion] = useState(0)

  // WebView2's PrintToPdf/Print read the note's title off `document.title`,
  // which index.html hardcodes to "Null Notes" — left alone, every export
  // and every physical print job carries that instead of the note's own
  // title. Restored on close so the window's own title (Alt+Tab, taskbar)
  // isn't left stuck on whatever note was last printed.
  useEffect(() => {
    const previous = document.title
    document.title = noteTitle
    return () => {
      document.title = previous
    }
  }, [noteTitle])

  // The dialog can mount before everything inside `.editor-pane` has
  // finished painting (a diagram, ink canvas, or code block that renders
  // in async) — the render effect below only reruns on checkbox/title
  // changes, so a first pass that catches incomplete content would
  // otherwise never retry. This bumps `contentVersion` (debounced, same
  // as a checkbox toggle) whenever the observed content actually changes.
  useEffect(() => {
    const contentEl = contentRef.current
    if (!contentEl) return

    let timer: ReturnType<typeof setTimeout>
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setContentVersion((v) => v + 1), RERENDER_DEBOUNCE_MS)
    })
    observer.observe(contentEl, { childList: true, subtree: true, attributes: true, characterData: true })

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [contentRef])

  // The `@page` CSS goes to Paged.js as an argument, never into `<head>`:
  // Paged.js only scrapes the document's own stylesheets when the argument is
  // *omitted*, and that path deletes them from the page. An empty array means
  // it parses nothing, so a `<head>` `@page` rule would never reach the
  // page-number/title/date margin boxes.
  const currentPageCss = () =>
    buildPageCss({
      showPageNumber,
      showTitle,
      showDate,
      title: noteTitle,
      date: formatPrintDate(new Date()),
    })

  function printPages<T>(run: () => Promise<T>): Promise<T> {
    const contentEl = contentRef.current
    if (!contentEl) return Promise.reject(new Error('Nothing to print.'))
    return withPrintMount(cloneForPagination(contentEl), currentPageCss(), run)
  }

  useEffect(() => {
    const contentEl = contentRef.current
    if (!contentEl || !container) return

    const pageCss = { [window.location.href]: currentPageCss() }

    let cancelled = false
    let previewer: Previewer | null = null
    setIsRendering(true)
    setError(null)
    const timer = setTimeout(() => {
      container.innerHTML = ''
      previewer = new Previewer()
      previewer
        .preview(cloneForPagination(contentEl), [pageCss], container)
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
      if (previewer) teardown(previewer)
    }
  }, [contentRef, container, showPageNumber, showTitle, showDate, noteTitle, contentVersion])

  return {
    containerRef: setContainer,
    showPageNumber,
    setShowPageNumber,
    showTitle,
    setShowTitle,
    showDate,
    setShowDate,
    isRendering,
    error,
    printPages,
  }
}
