import { Node, InputRule } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import katex from 'katex'

interface InlineMathAttrs {
  latex: string
}

function InlineMathView({ node }: ReactNodeViewProps) {
  const { latex } = node.attrs as unknown as InlineMathAttrs
  const html = katex.renderToString(latex, { throwOnError: false, displayMode: false })
  return (
    <NodeViewWrapper as="span" className="inline-math" spellCheck={false}>
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </NodeViewWrapper>
  )
}

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="inline-math"]',
        getAttrs: (el) => ({
          latex: (el as HTMLElement).getAttribute('data-latex') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-type': 'inline-math' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView)
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\$([^$\n]{1,200})\$$/,
        handler: ({ range, match, chain }): void | null => {
          const latex = match[1]
          if (!latex) return null
          chain()
            .deleteRange(range)
            .insertContentAt(range.from, { type: this.name, attrs: { latex } })
            .run()
        },
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: InlineMathAttrs }) {
          const s = state as { write: (str: string) => void }
          s.write(`$${node.attrs.latex}$`)
        },
        parse: {
          setup(markdownit: { core: { ruler: { push: (name: string, fn: (state: unknown) => void) => void } } }) {
            markdownit.core.ruler.push('inline_math', (state: unknown) => {
              const st = state as { tokens: Array<{ type: string; children: Array<{ type: string; content: string }> | null }> }
              for (const token of st.tokens) {
                if (token.type !== 'inline' || !token.children) continue
                const newChildren: typeof token.children = []
                for (const child of token.children) {
                  if (child.type !== 'text') {
                    newChildren.push(child)
                    continue
                  }
                  const parts = child.content.split(/\$([^$\n]{1,200})\$/)
                  if (parts.length === 1) {
                    newChildren.push(child)
                    continue
                  }
                  for (let i = 0; i < parts.length; i++) {
                    const part = parts[i] ?? ''
                    if (i % 2 === 0) {
                      if (part) newChildren.push({ type: 'text', content: part })
                    } else {
                      newChildren.push({ type: 'html_inline', content: `<span data-type="inline-math" data-latex="${encodeAttr(part)}"></span>` })
                    }
                  }
                }
                token.children = newChildren
              }
            })
          },
        },
      },
    }
  },
})

function encodeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
