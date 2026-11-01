import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { moveSelectionOutOf } from './collapseSelection'

interface DetailsAttrs {
  summary: string
}

// Open/closed is presentation-only — plain React state, never an attribute
// update. Toggling a section must not dirty the buffer or touch the .md;
// writing it there would mean expand/collapse triggers a save and, under
// P5's auto-commit, Git churn for what is purely a view-state click.
// Sections default open so nothing is hidden on first load.
function DetailsView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const { summary } = node.attrs as unknown as DetailsAttrs
  const [draft, setDraft] = useState(summary)
  const [open, setOpen] = useState(true)

  function handleSummaryBlur() {
    updateAttributes({ summary: draft })
  }

  function toggle() {
    setOpen((wasOpen) => {
      if (wasOpen) {
        const pos = getPos()
        if (pos !== undefined) moveSelectionOutOf(editor, pos, node.nodeSize)
      }
      return !wasOpen
    })
  }

  return (
    <NodeViewWrapper className={`details-wrapper${open ? ' open' : ''}`}>
      <div
        className="details-summary"
        contentEditable={false}
        // Without this, ProseMirror's own mousedown handling resolves the
        // click into a document position first (the nearest editable text,
        // which can be inside this very node's body) — clobbering whatever
        // selection toggle() is about to compute, same reason
        // .block-math-editor/.math-editor stop propagation on their own
        // contentEditable={false} controls.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={toggle}
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
            closeBlock: (n: unknown) => void
            renderContent: (n: unknown) => void
          }
          s.ensureNewLine()
          s.write('<details>')
          s.ensureNewLine()
          s.write(`<summary>${node.attrs.summary}</summary>`)
          // A real blank line, not just a newline: `<details>` opens a
          // CommonMark raw-HTML block that swallows every following line
          // verbatim until a blank line is reached — without one here, the
          // whole body (a bulleted line, a code span, anything starting
          // with a markdown-significant character) never reparses as real
          // markdown on the next load. It comes back as opaque text, whose
          // paragraph serializer then defensively backslash-escapes those
          // same leading characters — including, on the *next* round, the
          // backslash it just added — compounding without bound on every
          // save. `closeBlock` is how every other adjacent block pair in
          // this serializer already gets its blank line (the first write()
          // inside `renderContent` flushes it); `<summary>` just never went
          // through that machinery on its own, since it isn't one of
          // prosemirror-markdown's own block-node serializers.
          s.closeBlock(node)
          s.renderContent(node)
          s.ensureNewLine()
          s.write('</details>')
          s.closeBlock(node)
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
