import { useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { parseHeadings } from '../lib/outlineHeadings'

interface OutlinePanelProps {
  // The active note's markdown — the list itself is derived from this, not
  // the DOM. See lib/outlineHeadings.ts for why: watching ProseMirror's own
  // contentEditable with a MutationObserver used to be how this worked, and
  // it froze the app (P6-6 postmortem, docs/ROADMAP.md).
  content: string
  // The DOM node the rendered note lives in (`.editor-pane`) — read only at
  // click/scroll time to find and jump to a heading element, never observed.
  containerRef: RefObject<HTMLDivElement | null>
  // The scroll container that actually moves (`.editor-scroll`), used only
  // to know which heading is currently in view.
  scrollRef: RefObject<HTMLDivElement | null>
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

export function OutlinePanel({ content, containerRef, scrollRef }: OutlinePanelProps) {
  const headings = useMemo(() => parseHeadings(content), [content])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  useEffect(() => {
    const scroller = scrollRef.current
    const container = containerRef.current
    if (!scroller || !container) return

    function updateActive() {
      const els = Array.from(container!.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
      const top = scroller!.getBoundingClientRect().top
      let current: number | null = null
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top - top <= 24) current = i
      })
      setActiveIndex(current ?? (els.length > 0 ? 0 : null))
    }

    updateActive()
    scroller.addEventListener('scroll', updateActive, { passive: true })
    return () => scroller.removeEventListener('scroll', updateActive)
  }, [containerRef, scrollRef, headings.length])

  function jump(index: number) {
    const els = containerRef.current?.querySelectorAll<HTMLElement>(HEADING_SELECTOR)
    els?.[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div className="outline-panel">
      <p className="outline-panel-title">Outline</p>
      {headings.length === 0 ? (
        <p className="outline-empty">No headings in this note yet.</p>
      ) : (
        <ul className="outline-list">
          {headings.map((h, i) => (
            <li key={i}>
              <button
                className={`outline-item${i === activeIndex ? ' active' : ''}`}
                style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                onClick={() => jump(i)}
              >
                {h.text || '(untitled heading)'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
