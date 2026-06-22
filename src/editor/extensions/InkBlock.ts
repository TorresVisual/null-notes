import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { InkCanvas } from '../../ink/InkCanvas'

interface InkBlockAttrs {
  src: string
  width: number
  height: number
}

function InkBlockView({ node }: ReactNodeViewProps) {
  const { src, width, height } = node.attrs as unknown as InkBlockAttrs
  if (!src) return null
  return InkCanvas({ svgPath: src, width, height })
}

export const InkBlock = Node.create({
  name: 'inkBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: 800 },
      height: { default: 400 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ink-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'ink-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(InkBlockView)
  },
})
