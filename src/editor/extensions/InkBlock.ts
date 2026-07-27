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
      width: { default: 700 },
      height: { default: 900 },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="ink-block"]',
        getAttrs: (el) => ({
          src: (el as HTMLElement).getAttribute('data-src'),
          width: parseInt((el as HTMLElement).getAttribute('data-width') ?? '700', 10),
          height: parseInt((el as HTMLElement).getAttribute('data-height') ?? '900', 10),
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'ink-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(InkBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: InkBlockAttrs }) {
          const { src, width, height } = node.attrs
          ;(state as { write: (s: string) => void; ensureNewLine: () => void; closeBlock: (n: unknown) => void }).write('```ink\n')
          ;(state as { write: (s: string) => void }).write(JSON.stringify({ src, width, height }))
          ;(state as { ensureNewLine: () => void }).ensureNewLine()
          ;(state as { write: (s: string) => void }).write('```')
          ;(state as { closeBlock: (n: unknown) => void }).closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll<HTMLElement>('pre > code.language-ink').forEach((code) => {
              const pre = code.parentElement
              if (!pre) return
              try {
                const data = JSON.parse(code.textContent ?? '{}') as Partial<InkBlockAttrs>
                const div = document.createElement('div')
                div.setAttribute('data-type', 'ink-block')
                div.setAttribute('data-src', data.src ?? '')
                div.setAttribute('data-width', String(data.width ?? 700))
                div.setAttribute('data-height', String(data.height ?? 900))
                pre.replaceWith(div)
              } catch {
                // invalid JSON — leave as-is
              }
            })
          },
        },
      },
    }
  },
})
