import { useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { parseHeadings } from '../lib/outlineHeadings'
import { useWorkspaceStore } from '../store/workspace'
import { BookmarkMenuItem } from './BookmarkMenuItem'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from './ui/context-menu'

interface OutlinePanelProps {
  // The active note's markdown — the list itself is derived from this, not
  // the DOM. See lib/outlineHeadings.ts for why: watching ProseMirror's own
  // contentEditable with a MutationObserver used to be how this worked, and
  // it froze the app (P6-6 postmortem, docs/ROADMAP.md).
  content: string
  // The DOM node the rendered note lives in (`.editor-pane`) — read only at
  // click/cursor time to find and jump to a heading element, never observed.
  containerRef: RefObject<HTMLDivElement | null>
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

// Level 1 gets the longest tick, deeper levels progressively shorter — same
// visual grammar Notion's own collapsed outline uses so hierarchy reads at a
// glance without any text.
function tickWidth(level: number): number {
  return Math.max(6, 20 - (level - 1) * 4)
}

export function OutlinePanel({ content, containerRef }: OutlinePanelProps) {
  const headings = useMemo(() => parseHeadings(content), [content])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const notePath = useWorkspaceStore((s) => s.activeTab)
  // The menu is portaled, so reaching it counts as leaving the panel — keep
  // the flyout (the menu's trigger) mounted until the menu closes.
  const [menuOpen, setMenuOpen] = useState(false)

  // Tracks the section the *cursor* sits in, not what's scrolled into view —
  // reading (scrolling without touching the cursor) leaves the last-edited
  // heading marked, which is what a cursor-position indicator means.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function updateActiveFromSelection() {
      const node = document.getSelection()?.focusNode
      if (!node || !container!.contains(node)) return
      const els = Array.from(container!.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
      // Headings come out of querySelectorAll in document order, so the
      // cursor's section is the last one it hasn't yet moved past.
      let current: number | null = null
      for (let i = 0; i < els.length; i++) {
        const heading = els[i]!
        const cursorReachedThis =
          heading.contains(node) || !!(heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
        if (!cursorReachedThis) break
        current = i
      }
      setActiveIndex(current)
    }

    updateActiveFromSelection()
    document.addEventListener('selectionchange', updateActiveFromSelection)
    return () => document.removeEventListener('selectionchange', updateActiveFromSelection)
  }, [containerRef, headings.length])

  function jump(index: number) {
    const els = containerRef.current?.querySelectorAll<HTMLElement>(HEADING_SELECTOR)
    els?.[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div
      className="outline-panel"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => !menuOpen && setExpanded(false)}
    >
      <div className="outline-ticks" aria-hidden={expanded}>
        {headings.length === 0 ? (
          <span className="outline-tick outline-tick-empty" />
        ) : (
          headings.map((h, i) => (
            <span
              key={i}
              className={`outline-tick${i === activeIndex ? ' active' : ''}`}
              style={{ width: tickWidth(h.level) }}
            />
          ))
        )}
      </div>
      {expanded && (
        <div className="outline-flyout">
          <p className="outline-panel-title">Outline</p>
          {headings.length === 0 ? (
            <p className="outline-empty">No headings in this note yet.</p>
          ) : (
            <ul className="outline-list">
              {headings.map((h, i) => (
                <li key={i}>
                  <ContextMenu
                    onOpenChange={(open) => {
                      setMenuOpen(open)
                      if (!open) setExpanded(false)
                    }}
                  >
                    <ContextMenuTrigger asChild>
                      <button
                        className={`outline-item${i === activeIndex ? ' active' : ''}`}
                        style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                        onClick={() => jump(i)}
                      >
                        {h.text || '(untitled heading)'}
                      </button>
                    </ContextMenuTrigger>
                    {notePath && h.text && (
                      <ContextMenuContent className="context-menu">
                        <BookmarkMenuItem
                          bookmark={{ kind: 'heading', path: notePath, heading: h.text }}
                          label="Bookmark heading"
                        />
                      </ContextMenuContent>
                    )}
                  </ContextMenu>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
