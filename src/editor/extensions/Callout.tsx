import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'

type CalloutType = 'note' | 'tip' | 'warning' | 'danger' | 'info' | 'important'

interface CalloutAttrs {
  calloutType: CalloutType
  title: string
}

const CALLOUT_LABEL: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
  info: 'Info',
  important: 'Important',
}

function CalloutView({ node }: ReactNodeViewProps) {
  const { calloutType, title } = node.attrs as unknown as CalloutAttrs
  return (
    <NodeViewWrapper className={`callout callout-${calloutType}`}>
      <div className="callout-header" contentEditable={false}>
        <span className="callout-label">{CALLOUT_LABEL[calloutType] ?? calloutType.toUpperCase()}</span>
        {title && <span className="callout-title">{title}</span>}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      calloutType: { default: 'note' },
      title: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: (el) => ({
          calloutType: (el as HTMLElement).getAttribute('data-callout-type') ?? 'note',
          title: (el as HTMLElement).getAttribute('data-callout-title') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'callout' }, 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: Record<string, unknown>,
          node: { attrs: CalloutAttrs; content: unknown },
        ) {
          const s = state as {
            write: (str: string) => void
            ensureNewLine: () => void
            closeBlock: (n: unknown) => void
            renderContent: (n: unknown) => void
            wrapBlock: (d: string, fd: string | null, n: unknown, f: () => void) => void
          }
          const type = (node.attrs.calloutType ?? 'note').toUpperCase()
          const title = node.attrs.title as string
          const firstDelim = title ? `> [!${type}] ${title}\n> ` : `> [!${type}]\n> `
          s.wrapBlock('> ', firstDelim, node, () => s.renderContent(node))
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('blockquote').forEach((bq) => {
              const firstP = bq.querySelector(':scope > p:first-child')
              if (!firstP) return
              const text = firstP.textContent?.trim() ?? ''
              const match = /^\[!(NOTE|TIP|WARNING|DANGER|INFO|IMPORTANT)\](.*)/i.exec(text)
              if (!match) return
              const calloutType = match[1]!.toLowerCase()
              const title = match[2]?.trim() ?? ''
              const div = document.createElement('div')
              div.setAttribute('data-type', 'callout')
              div.setAttribute('data-callout-type', calloutType)
              div.setAttribute('data-callout-title', title)
              firstP.remove()
              while (bq.firstChild) div.appendChild(bq.firstChild)
              bq.replaceWith(div)
            })
          },
        },
      },
    }
  },
})
