import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

interface OutlineHeading {
  id: string
  text: string
  level: number
}

interface OutlinePanelProps {
  // The DOM node the rendered note lives in (`.editor-pane`) — headings are
  // read straight from ProseMirror's own output, so this needs no backend
  // work and no lifted editor instance.
  containerRef: RefObject<HTMLDivElement | null>
  // The scroll container that actually moves (`.editor-scroll`), used only
  // to know which heading is currently in view.
  scrollRef: RefObject<HTMLDivElement | null>
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

export function OutlinePanel({ containerRef, scrollRef }: OutlinePanelProps) {
  const [headings, setHeadings] = useState<OutlineHeading[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // Headings change whenever the note's content changes; a MutationObserver
  // on ProseMirror's own DOM catches that without touching the editor.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function collect() {
      const els = Array.from(container!.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
      const next = els.map((el, i) => {
        const id = `outline-heading-${i}`
        el.dataset.outlineId = id
        return { id, text: el.textContent ?? '', level: Number(el.tagName[1]) }
      })
      setHeadings(next)
    }

    collect()
    const observer = new MutationObserver(collect)
    observer.observe(container, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [containerRef])

  useEffect(() => {
    const scroller = scrollRef.current
    const container = containerRef.current
    if (!scroller || !container) return

    function updateActive() {
      const els = Array.from(container!.querySelectorAll<HTMLElement>('[data-outline-id]'))
      const top = scroller!.getBoundingClientRect().top
      let current: string | null = null
      for (const el of els) {
        if (el.getBoundingClientRect().top - top <= 24) {
          current = el.dataset.outlineId ?? current
        }
      }
      setActiveId(current ?? els[0]?.dataset.outlineId ?? null)
    }

    updateActive()
    scroller.addEventListener('scroll', updateActive, { passive: true })
    return () => scroller.removeEventListener('scroll', updateActive)
  }, [containerRef, scrollRef, headings.length])

  function jump(id: string) {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-outline-id="${id}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div className="outline-panel">
      <p className="outline-panel-title">Outline</p>
      {headings.length === 0 ? (
        <p className="outline-empty">No headings in this note yet.</p>
      ) : (
        <ul className="outline-list">
          {headings.map((h) => (
            <li key={h.id}>
              <button
                className={`outline-item${h.id === activeId ? ' active' : ''}`}
                style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                onClick={() => jump(h.id)}
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
