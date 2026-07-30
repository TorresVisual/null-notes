import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

interface DetailsAttrs {
  summary: string
  open: boolean
}

function DetailsView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const { summary, open } = node.attrs as unknown as DetailsAttrs
  const [draft, setDraft] = useState(summary)

  function handleSummaryBlur() {
    updateAttributes({ summary: draft })
  }

  return (
    <NodeViewWrapper className={`details-wrapper${open ? ' open' : ''}`}>
      <div
        className="details-summary"
        contentEditable={false}
        onClick={() => updateAttributes({ open: !open })}
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
      {open && <NodeViewContent className="details-body" />}
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
      open: { default: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="details"]',
        getAttrs: (el) => ({
          summary: (el as HTMLElement).getAttribute('data-summary') ?? '',
          open: (el as HTMLElement).hasAttribute('data-open'),
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'details' }), 0]
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
          s.write(`<details${node.attrs.open ? ' open' : ''}>`)
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
              if (details.hasAttribute('open')) div.setAttribute('data-open', '')

              while (details.firstChild) div.appendChild(details.firstChild)
              details.replaceWith(div)
            })
          },
        },
      },
    }
  },
})
