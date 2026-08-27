import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { CornerUpLeft } from 'lucide-react'

interface FootnoteDefinitionAttrs {
  label: string
}

/** Same retry-across-frames shape as `FootnoteReference.tsx`'s own
 *  `scrollToDefinition` — jumping back to whichever reference this
 *  definition belongs to. A label can be referenced more than once; this
 *  always jumps to the *first* one in document order, the same "one
 *  unambiguous answer, not a menu" posture `.footnote-def`'s own
 *  single-owner numbering already assumes. */
function scrollToFirstReference(label: string, attempt = 0): void {
  const el = document.querySelector<HTMLElement>(`.footnote-ref[data-label="${label}"]`)
  if (el) {
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    el.classList.add('cross-ref-target')
    setTimeout(() => el.classList.remove('cross-ref-target'), 1500)
    return
  }
  if (attempt < 90) requestAnimationFrame(() => scrollToFirstReference(label, attempt + 1))
}

function FootnoteDefinitionView({ node }: ReactNodeViewProps) {
  const { label } = node.attrs as unknown as FootnoteDefinitionAttrs
  return (
    <NodeViewWrapper className="footnote-def" data-type="footnote-def" data-label={label}>
      <button
        type="button"
        className="footnote-def-back"
        contentEditable={false}
        title={`Jump back to reference [${label}]`}
        onMouseDown={(e) => {
          e.preventDefault()
          scrollToFirstReference(label)
        }}
      >
        <CornerUpLeft size={12} />
        {label}.
      </button>
      <NodeViewContent className="footnote-def-body" />
    </NodeViewWrapper>
  )
}

export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'inline*',

  addAttributes() {
    return {
      label: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="footnote-def"]',
        getAttrs: (el) => ({
          label: (el as HTMLElement).getAttribute('data-label') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'footnote-def' }, 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteDefinitionView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: FootnoteDefinitionAttrs }) {
          const s = state as {
            write: (str: string) => void
            renderInline: (n: unknown, fromBlockStart?: boolean) => void
            closeBlock: (n: unknown) => void
          }
          s.write(`[^${node.attrs.label}]: `)
          s.renderInline(node, false)
          s.closeBlock(node)
        },
        parse: {
          // A block rule, registered before `reference` — not merely
          // before `paragraph` — and that distinction is load-bearing.
          // `[^label]: text` is syntactically indistinguishable from a
          // CommonMark link reference definition (`[label]: destination`)
          // whenever the footnote text happens to be a single bare word
          // with no spaces (`[^1]: First.`): markdown-it's own built-in
          // `reference` rule runs *before* `paragraph` in the default
          // ruler order and silently consumes exactly that shape, in that
          // case leaving no token at all rather than falling through to
          // this rule or to `paragraph`. Registering before `reference`
          // itself, not just before `paragraph`, is what stops that.
          //
          // Scope, deliberate for a first cut: the definition's body is
          // the rest of *this one line* only — no indented continuation
          // lines for a second paragraph, matching how the overwhelming
          // majority of real footnotes read (a sentence, maybe with a
          // link). `state.md.renderInline` is what gives that one line
          // real nested markdown (bold, links, code spans) rather than
          // literal text — the same API `paragraph`'s own block rule uses
          // internally (push an `inline` token and let the core inline
          // pass recurse into it), just called directly since this rule
          // needs the *rendered HTML* now, to embed in its own wrapper.
          setup(markdownit: {
            block: {
              ruler: {
                before: (
                  ref: string,
                  name: string,
                  fn: (state: unknown, startLine: number, endLine: number, silent: boolean) => boolean,
                  options?: { alt: string[] },
                ) => void
              }
            }
          }) {
            markdownit.block.ruler.before(
              'reference',
              'footnote_definition',
              (state: unknown, startLine: number, _endLine: number, silent: boolean): boolean => {
                const st = state as {
                  src: string
                  bMarks: number[]
                  eMarks: number[]
                  tShift: number[]
                  line: number
                  md: { renderInline: (src: string, env?: unknown) => string }
                  env: unknown
                  push: (type: string, tag: string, nesting: number) => { content: string; map: [number, number] | null }
                }

                const pos = st.bMarks[startLine]! + st.tShift[startLine]!
                const max = st.eMarks[startLine]!
                const line = st.src.slice(pos, max)

                const match = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/.exec(line)
                if (!match) return false
                if (silent) return true

                const [, label, text] = match
                const rendered = st.md.renderInline(text ?? '', st.env)
                const token = st.push('html_block', '', 0)
                token.content = `<div data-type="footnote-def" data-label="${encodeAttr(label!)}">${rendered}</div>\n`
                token.map = [startLine, startLine + 1]

                st.line = startLine + 1
                return true
              },
              { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
            )
          },
        },
      },
    }
  },
})

function encodeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
