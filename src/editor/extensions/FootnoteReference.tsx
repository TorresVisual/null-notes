import { Node, InputRule } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { encodeAttr } from '../../lib/htmlAttr'

interface FootnoteReferenceAttrs {
  label: string
}

/** Retries across a bounded number of frames, the same shape `CrossRef.ts`'s
 *  `scrollToBlock` already uses — the target definition may not be in the
 *  DOM yet (e.g. this same click just switched tabs). Same-document only,
 *  so no backend resolution step is needed the way a cross-note jump has. */
function scrollToDefinition(label: string, attempt = 0): void {
  const el = document.querySelector<HTMLElement>(`.footnote-def[data-label="${label}"]`)
  if (el) {
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    el.classList.add('cross-ref-target')
    setTimeout(() => el.classList.remove('cross-ref-target'), 1500)
    return
  }
  if (attempt < 90) requestAnimationFrame(() => scrollToDefinition(label, attempt + 1))
}

function FootnoteReferenceView({ node }: ReactNodeViewProps) {
  const { label } = node.attrs as unknown as FootnoteReferenceAttrs
  return (
    <NodeViewWrapper as="sup" className="footnote-ref" data-label={label} contentEditable={false} spellCheck={false}>
      <button
        type="button"
        className="footnote-ref-button"
        title={`Jump to footnote ${label}`}
        onMouseDown={(e) => {
          // Same reasoning as MathCopyButton/MathSnippetMenu: act on
          // mousedown so this never fights a blur/selection change the
          // surrounding editor might otherwise make of the click first.
          e.preventDefault()
          scrollToDefinition(label)
        }}
      >
        [{label}]
      </button>
    </NodeViewWrapper>
  )
}

export const FootnoteReference = Node.create({
  name: 'footnoteReference',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'sup[data-type="footnote-ref"]',
        // `Superscript`'s mark rule matches bare `sup` at the schema's
        // default priority (50) — extension registration order alone
        // doesn't settle a node-vs-mark tie the way it does between two
        // node rules, so without this, an empty `<sup data-type="footnote-
        // ref">` (nothing for a mark to even apply *to*) was silently
        // read as a contentless superscript mark and dropped outright,
        // taking the whole reference with it.
        priority: 100,
        getAttrs: (el) => ({
          label: (el as HTMLElement).getAttribute('data-label') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', { ...HTMLAttributes, 'data-type': 'footnote-ref' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteReferenceView)
  },

  // Typing `[^1]` directly becomes a real, clickable reference — the same
  // "type it and it becomes real" pattern `$...$` (InlineMath) and
  // `SmartSymbols` already follow. It does not also create a matching
  // definition; *Footnote* in the slash menu is the one deliberate path
  // that sets up both pieces together (see SlashCommands.tsx) — typing the
  // reference alone leaves the label unresolved until a definition with
  // that label exists somewhere in the note, the same "prefer a miss"
  // posture as every other resolver in this codebase.
  addInputRules() {
    return [
      new InputRule({
        find: /\[\^([^\]\s]+)\]$/,
        handler: ({ range, match, chain }): void | null => {
          const label = match[1]
          if (!label) return null
          chain()
            .deleteRange(range)
            .insertContentAt(range.from, { type: this.name, attrs: { label } })
            .run()
        },
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: FootnoteReferenceAttrs }) {
          const s = state as { write: (str: string) => void }
          s.write(`[^${node.attrs.label}]`)
        },
        parse: {
          // Inline-ruler, before `escape` — the same reasoning `InlineMath`
          // already documents: markdown-it's built-in `escape` rule runs
          // before any later inline rule ever sees `state.src`, and a
          // footnote label containing an underscore or other CommonMark
          // escape-significant character would otherwise be corrupted
          // before this rule gets a look at it.
          //
          // A `[^label]:` at the very *start* of a line is a definition,
          // not a reference — but this rule never has to check for that
          // itself: the block-level `footnote_definition` rule (see
          // FootnoteDefinition.tsx) runs first and, when it matches, claims
          // the whole line before inline tokenization ever begins on it.
          setup(markdownit: {
            inline: {
              ruler: {
                before: (ref: string, name: string, fn: (state: unknown, silent: boolean) => boolean) => void
              }
            }
          }) {
            markdownit.inline.ruler.before('escape', 'footnote_reference', (state: unknown, silent: boolean): boolean => {
              const st = state as {
                src: string
                pos: number
                posMax: number
                push: (type: string, tag: string, nesting: number) => { content: string }
              }

              if (st.src.charCodeAt(st.pos) !== 0x5b /* [ */) return false
              if (st.src.charCodeAt(st.pos + 1) !== 0x5e /* ^ */) return false

              const max = st.posMax
              let pos = st.pos + 2
              while (pos < max) {
                const code = st.src.charCodeAt(pos)
                if (code === 0x5d /* ] */) break
                if (code === 0x20 || code === 0x0a /* space, \n */) return false
                pos++
              }
              if (pos >= max || st.src.charCodeAt(pos) !== 0x5d) return false
              const label = st.src.slice(st.pos + 2, pos)
              if (!label) return false

              if (!silent) {
                const token = st.push('html_inline', '', 0)
                token.content = `<sup data-type="footnote-ref" data-label="${encodeAttr(label)}"></sup>`
              }
              st.pos = pos + 1
              return true
            })
          },
        },
      },
    }
  },
})

