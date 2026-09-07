import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useId, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, theme: 'default' })

interface MermaidAttrs {
  code: string
}

function MermaidView({ node }: ReactNodeViewProps) {
  const { code } = node.attrs as unknown as MermaidAttrs
  const uid = useId().replace(/[^a-z0-9]/gi, '')
  const id = `md${uid}`
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    setError(false)
    if (!code.trim()) return
    mermaid
      .render(id, code)
      .then(({ svg: out }) => setSvg(out))
      .catch(() => setError(true))
  }, [code, id])

  return (
    <NodeViewWrapper className="mermaid-block" spellCheck={false}>
      {svg && !error ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre className={error ? 'mermaid-error' : undefined}>{code}</pre>
      )}
    </NodeViewWrapper>
  )
}

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaid-block"]',
        getAttrs: (el) => ({
          code: (el as HTMLElement).getAttribute('data-code') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'mermaid-block' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: MermaidAttrs }) {
          const s = state as {
            write: (str: string) => void
            ensureNewLine: () => void
            closeBlock: (n: unknown) => void
          }
          s.write('```mermaid\n')
          s.write(node.attrs.code)
          s.ensureNewLine()
          s.write('```')
          s.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll<HTMLElement>('pre > code.language-mermaid').forEach((code) => {
              const pre = code.parentElement
              if (!pre) return
              const div = document.createElement('div')
              div.setAttribute('data-type', 'mermaid-block')
              div.setAttribute('data-code', code.textContent ?? '')
              pre.replaceWith(div)
            })
          },
        },
      },
    }
  },
})
