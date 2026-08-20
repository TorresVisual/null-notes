import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
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
function DetailsView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const { summary } = node.attrs as unknown as DetailsAttrs
  const [draft, setDraft] = useState(summary)
  const [open, setOpen] = useState(true)

  function handleSummaryBlur() {
    updateAttributes({ summary: draft })
  }

  // Collapsing only ever hides the body via CSS (see the module comment) —
  // the ProseMirror selection is never touched by that on its own, so a
  // cursor left inside the body would keep silently accepting keystrokes
  // into now-invisible content. Move it out to just before the section
  // whenever a collapse would otherwise strand it there.
  function toggle() {
    setOpen((wasOpen) => {
      const nowOpen = !wasOpen
      if (!nowOpen) {
        const pos = getPos()
        if (pos !== undefined) {
          const { from, to } = editor.state.selection
          if (from >= pos && to <= pos + node.nodeSize) {
            // TipTap's `focus(number)` command constructs a TextSelection at
            // that exact position rather than searching for the nearest valid
            // one — it throws/no-ops on a raw block-boundary position like
            // this node's own start. TextSelection.near does the search: bias
            // -1 targets just before the node (searching backward finds the
            // preceding block's content); at doc position 0 there's nothing
            // before, so fall back to bias 1 from just after the node.
            const target = pos > 0 ? pos : pos + node.nodeSize
            const bias = pos > 0 ? -1 : 1
            const selection = TextSelection.near(editor.state.doc.resolve(target), bias)
            editor.view.dispatch(editor.state.tr.setSelection(selection))
            editor.commands.focus()
          }
        }
      }
      return nowOpen
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
