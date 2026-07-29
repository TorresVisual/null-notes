import { Node, InputRule } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import katex from 'katex'

interface InlineMathAttrs {
  latex: string
}

interface Rendered {
  html: string
  error: string | null
}

// throwOnError:true is only a way to get the message out — the fallback render
// is the same red error markup KaTeX would have produced on its own.
function render(latex: string): Rendered {
  try {
    return { html: katex.renderToString(latex, { throwOnError: true, displayMode: false }), error: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      html: katex.renderToString(latex, { throwOnError: false, displayMode: false }),
      error: message.replace(/^KaTeX parse error: /, ''),
    }
  }
}

function InlineMathView({ node, editor, getPos, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const { latex } = node.attrs as unknown as InlineMathAttrs
  // A node inserted from the slash menu or shortcut arrives empty; it has
  // nothing to show, so it opens straight into the editor.
  const [editing, setEditing] = useState(() => editor.isEditable && latex === '')
  const [draft, setDraft] = useState(latex)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function open() {
    if (!editor.isEditable) return
    setDraft(latex)
    setEditing(true)
  }

  // Refocusing is right for Enter and Escape, where the user stayed in the
  // editor; on blur they have already clicked somewhere else and taking the
  // caret back would fight them.
  function close(refocus: boolean) {
    setEditing(false)
    if (!refocus) return
    const pos = getPos()
    if (pos === undefined) editor.commands.focus()
    else editor.commands.focus(pos + node.nodeSize)
  }

  function commit(refocus: boolean) {
    const next = draft.trim()
    if (!next) {
      setEditing(false)
      deleteNode()
      if (refocus) editor.commands.focus()
      return
    }
    updateAttributes({ latex: next })
    close(refocus)
  }

  function cancel() {
    if (!latex) {
      setEditing(false)
      deleteNode()
      editor.commands.focus()
      return
    }
    setDraft(latex)
    close(true)
  }

  const display = render(latex)
  const preview = render(draft)

  return (
    <NodeViewWrapper
      as="span"
      className={`inline-math${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      spellCheck={false}
    >
      <span
        className="inline-math-render"
        onClick={open}
        dangerouslySetInnerHTML={{ __html: display.html }}
      />
      {editing && (
        <span className="math-editor" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            className="math-editor-input"
            value={draft}
            spellCheck={false}
            placeholder="e^{i\pi} + 1 = 0"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(false)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(true)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
          />
          <span className="math-editor-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />
          {preview.error && <span className="math-editor-error">{preview.error}</span>}
        </span>
      )}
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

  addKeyboardShortcuts() {
    return {
      // Selected text becomes the equation's source, so wrapping something
      // already typed takes one keystroke.
      'Mod-Shift-e': () => {
        const { from, to, empty } = this.editor.state.selection
        const latex = empty ? '' : this.editor.state.doc.textBetween(from, to)
        return this.editor
          .chain()
          .focus()
          .insertContentAt({ from, to }, { type: this.name, attrs: { latex } })
          .run()
      },
    }
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
