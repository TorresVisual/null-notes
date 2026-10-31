import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { encodeAttr } from '../../lib/htmlAttr'
import { parseEmbedParagraph } from '../../lib/embedSyntax'
import { formatWikiLink } from '../../lib/wikiLinkSyntax'

interface NoteEmbedAttrs {
  title: string
  heading: string
}

function EmbedView({ node }: ReactNodeViewProps) {
  const { title } = node.attrs as unknown as NoteEmbedAttrs
  return (
    <NodeViewWrapper className="note-embed" spellCheck={false}>
      {title}
    </NodeViewWrapper>
  )
}

interface BlockState {
  src: string
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  line: number
  level: number
  parentType: string
  push: (type: string, tag: string, nesting: number) => { content: string; map: [number, number]; level: number }
}

export const NoteEmbed = Node.create({
  name: 'noteEmbed',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: '' },
      heading: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="note-embed"]',
        getAttrs: (el) => ({
          title: (el as HTMLElement).getAttribute('data-title') ?? '',
          heading: (el as HTMLElement).getAttribute('data-heading') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'note-embed' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: Record<string, unknown>,
          node: { attrs: NoteEmbedAttrs },
        ) {
          const s = state as { write: (str: string) => void; closeBlock: (n: unknown) => void }
          s.write(`![[${formatWikiLink({ ...node.attrs, label: '' })}]]`)
          s.closeBlock(node)
        },
        parse: {
          // A block rule with no `alt: ['paragraph']`, so it can only start a
          // block, never interrupt one: the embed has to be its own paragraph
          // (blank line or end of input after it). Anything else stays inline
          // text and falls through to the wiki-link rule.
          setup(markdownit: {
            block: {
              ruler: {
                before: (
                  ref: string,
                  name: string,
                  fn: (state: unknown, startLine: number, endLine: number, silent: boolean) => boolean,
                ) => void
              }
            }
          }) {
            markdownit.block.ruler.before('paragraph', 'note_embed', (state, startLine, endLine, silent) => {
              const st = state as BlockState
              if (st.level > 0) return false
              const line = st.src.slice((st.bMarks[startLine] ?? 0) + (st.tShift[startLine] ?? 0), st.eMarks[startLine])
              const parts = parseEmbedParagraph(line)
              if (!parts) return false
              const next = startLine + 1
              if (next < endLine) {
                const nextLine = st.src.slice((st.bMarks[next] ?? 0) + (st.tShift[next] ?? 0), st.eMarks[next])
                if (nextLine.trim() !== '') return false
              }
              if (silent) return true

              const token = st.push('html_block', '', 0)
              token.content =
                `<div data-type="note-embed" data-title="${encodeAttr(parts.title)}"` +
                ` data-heading="${encodeAttr(parts.heading)}"></div>\n`
              token.map = [startLine, next]
              token.level = st.level
              st.line = next
              return true
            })
          },
        },
      },
    }
  },
})
