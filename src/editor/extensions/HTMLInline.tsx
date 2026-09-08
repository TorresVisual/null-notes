import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { sanitizeNoteHtml } from '@/lib/sanitizeHtml'

// Inline HTML elements that TipTap's schema doesn't know about natively.
// We preserve these verbatim through the round-trip using dangerouslySetInnerHTML.
const INLINE_TAGS = [
  'abbr', 'acronym', 'bdi', 'bdo', 'big', 'cite', 'data', 'dfn',
  'ins', 'meter', 'nobr', 'output', 'progress', 'q', 'rp', 'rt',
  'ruby', 'samp', 's', 'small', 'time', 'tt', 'var', 'wbr',
]

interface HTMLInlineAttrs {
  html: string
}

function HTMLInlineView({ node }: ReactNodeViewProps) {
  const { html } = node.attrs as unknown as HTMLInlineAttrs
  return (
    <NodeViewWrapper as="span" className="html-inline-container" spellCheck={false}>
      {/* eslint-disable-next-line react/no-danger -- run through sanitizeNoteHtml (H-2), not raw. */}
      <span dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(html) }} />
    </NodeViewWrapper>
  )
}

export const HTMLInline = Node.create({
  name: 'htmlInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      html: { default: '' },
    }
  },

  parseHTML() {
    return INLINE_TAGS.map((tag) => ({
      tag,
      getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML }),
    }))
  },

  renderHTML({ HTMLAttributes }) {
    // Placeholder span in the editor DOM — the NodeView replaces it.
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'html-inline' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(HTMLInlineView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: HTMLInlineAttrs }) {
          ;(state as { write: (s: string) => void }).write(node.attrs.html)
        },
      },
    }
  },
})
