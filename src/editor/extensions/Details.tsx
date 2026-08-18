import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

interface DetailsAttrs {
  summary: string
}

// Open/closed is presentation-only — plain React state, never an attribute
// update. Toggling a section must not dirty the buffer or touch the .md;
// writing it there would mean expand/collapse triggers a save and, under
// P5's auto-commit, Git churn for what is purely a view-state click.
// Sections default open so nothing is hidden on first load.
function DetailsView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const { summary } = node.attrs as unknown as DetailsAttrs
  const [draft, setDraft] = useState(summary)
  const [open, setOpen] = useState(true)

  function handleSummaryBlur() {
    updateAttributes({ summary: draft })
  }

  return (
    <NodeViewWrapper className={`details-wrapper${open ? ' open' : ''}`}>
      <div
        className="details-summary"
        contentEditable={false}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight size={13} className="details-chevron" />
        {editor.isEditable ? (
          <input
            className="details-summary-input"
            value={draft}
            spellCheck
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleSummaryBlur}
            onClick={(e) => e.stopPropagation()}
            placeholder="Summary…"
          />
        ) : (
          <span>{summary}</span>
        )}
      </div>
      <NodeViewContent className="details-body" />
    </NodeViewWrapper>
  )
}

export const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      summary: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="details"]',
        getAttrs: (el) => ({
          summary: (el as HTMLElement).getAttribute('data-summary') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'details' }, 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DetailsView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: Record<string, unknown>,
          node: { attrs: DetailsAttrs; content: unknown },
        ) {
          const s = state as {
            write: (text: string) => void
            ensureNewLine: () => void
            renderContent: (n: unknown) => void
          }
          s.ensureNewLine()
          s.write('<details>')
          s.ensureNewLine()
          s.write(`<summary>${node.attrs.summary}</summary>`)
          s.ensureNewLine()
          s.renderContent(node)
          s.ensureNewLine()
          s.write('</details>')
          s.ensureNewLine()
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('details').forEach((details) => {
              const summaryEl = details.querySelector(':scope > summary')
              const summaryText = summaryEl?.textContent?.trim() ?? ''
              summaryEl?.remove()

              const div = document.createElement('div')
              div.setAttribute('data-type', 'details')
              div.setAttribute('data-summary', summaryText)

              while (details.firstChild) div.appendChild(details.firstChild)
              details.replaceWith(div)
            })
          },
        },
      },
    }
  },
})
