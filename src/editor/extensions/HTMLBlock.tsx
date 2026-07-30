import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'

// Block-level HTML elements (and void/self-contained tags) that TipTap doesn't
// handle natively. We preserve these verbatim as opaque blocks. This includes
// SVG, MathML, media, interactive, scripting, and semantic section elements.
//
// Callouts (`div[data-type="callout"]`), wiki-links, tags, math nodes, mermaid
// and ink are all handled by their own dedicated extensions and are NOT matched
// here — those parseHTML rules run first thanks to TipTap's priority system.
const BLOCK_TAGS = [
  // Semantic structure
  'address', 'article', 'aside', 'footer', 'header', 'main', 'nav',
  'section', 'search',
  // Media & embedded
  'audio', 'video', 'picture', 'embed', 'object', 'iframe',
  // SVG & MathML (complete trees captured as one opaque blob)
  'svg', 'math',
  // Scripting / templating
  'canvas', 'noscript', 'script', 'slot', 'template',
  // Forms (when block-level standalone)
  'form', 'fieldset',
  // Interactive
  'dialog',
  // Deprecated but still encountered
  'marquee', 'frame', 'frameset', 'noframes',
  // Figure semantics
  'figure',
]

interface HTMLBlockAttrs {
  html: string
  tag: string
}

function HTMLBlockView({ node }: ReactNodeViewProps) {
  const { html } = node.attrs as unknown as HTMLBlockAttrs
  return (
    <NodeViewWrapper className="html-block-container" contentEditable={false} spellCheck={false}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </NodeViewWrapper>
  )
}

export const HTMLBlock = Node.create({
  name: 'htmlBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      html: { default: '' },
      tag: { default: '' },
    }
  },

  parseHTML() {
    return BLOCK_TAGS.map((tag) => ({
      tag,
      getAttrs: (el) => ({ html: (el as HTMLElement).outerHTML, tag }),
    }))
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'html-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(HTMLBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: HTMLBlockAttrs }) {
          const s = state as {
            write: (text: string) => void
            ensureNewLine: () => void
            closeBlock: (node: unknown) => void
          }
          s.ensureNewLine()
          s.write(node.attrs.html)
          s.closeBlock(node)
        },
      },
    }
  },
})
