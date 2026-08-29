// TEMPLATE — copy to src/editor/extensions/__NodeName__.tsx and replace every
// __NodeName__ / __nodeName__ / __node-name__ / __fence-lang__ placeholder.
//
// Modeled on DiagramBlock.tsx's fenced-code-block markdown pattern (the
// simplest round-trippable shape for a node with structured attrs). If this
// node holds free-form prose instead of a fixed attrs bag, use
// FootnoteDefinition.tsx's NodeViewContent-based pattern instead — this
// template isn't the only valid shape, just the most common starting point.
//
// Do not delete the TODO comments until you've actually done each one — they
// exist because CLAUDE.md calls out these exact failure modes as silent:
// a node without markdown.serialize/parse serialises as escaped plain text
// on save→reload, and a non-prose node without spellcheck="false" gets
// underlined by the OS spellchecker.

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'

interface __NodeName__Attrs {
  // TODO: replace with this node's real attributes.
  value: string
}

function __NodeName__View({ node }: ReactNodeViewProps) {
  const { value } = node.attrs as unknown as __NodeName__Attrs

  return (
    // spellCheck={false} is required for any non-prose content — the editor
    // root sets spellcheck on itself and this node inherits it otherwise.
    // Drop this prop only if the node view genuinely renders editable prose.
    <NodeViewWrapper className="__node-name__" spellCheck={false}>
      {/* TODO: replace with the real node view. */}
      <div className="__node-name__-content">{value}</div>
    </NodeViewWrapper>
  )
}

export const __NodeName__ = Node.create({
  name: '__nodeName__',
  group: 'block',
  atom: true, // remove if this node should hold editable child content

  addAttributes() {
    return {
      value: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="__node-name__"]',
        getAttrs: (el) => ({
          value: (el as HTMLElement).getAttribute('data-value') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': '__node-name__' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(__NodeName__View)
  },

  // TODO (required, not optional): without this, the node serialises as
  // escaped plain text and every attribute is silently lost on save→reload.
  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: __NodeName__Attrs }) {
          const s = state as {
            write: (str: string) => void
            ensureNewLine: () => void
            closeBlock: (n: unknown) => void
          }
          s.write('```__fence-lang__\n')
          s.write(JSON.stringify(node.attrs))
          s.ensureNewLine()
          s.write('```')
          s.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element
              .querySelectorAll<HTMLElement>('pre > code.language-__fence-lang__')
              .forEach((code) => {
                const pre = code.parentElement
                if (!pre) return
                try {
                  const data = JSON.parse(code.textContent ?? '{}') as Partial<__NodeName__Attrs>
                  const div = document.createElement('div')
                  div.setAttribute('data-type', '__node-name__')
                  div.setAttribute('data-value', data.value ?? '')
                  pre.replaceWith(div)
                } catch {
                  // invalid JSON — leave as the raw code block
                }
              })
          },
        },
      },
    }
  },
})
