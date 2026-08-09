import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import katex from 'katex'

interface BlockMathAttrs {
  latex: string
}

interface Rendered {
  html: string
  error: string | null
}

function render(latex: string): Rendered {
  try {
    return { html: katex.renderToString(latex, { throwOnError: true, displayMode: true }), error: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      html: katex.renderToString(latex, { throwOnError: false, displayMode: true }),
      error: message.replace(/^KaTeX parse error: /, ''),
    }
  }
}

function BlockMathView({ node, editor, getPos, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const { latex } = node.attrs as unknown as BlockMathAttrs
  const [editing, setEditing] = useState(() => editor.isEditable && latex === '')
  const [draft, setDraft] = useState(latex)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  function open() {
    if (!editor.isEditable) return
    setDraft(latex)
    setEditing(true)
  }

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
      className={`block-math${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      spellCheck={false}
    >
      {!editing && (
        <div className="block-math-render" onClick={open} dangerouslySetInnerHTML={{ __html: display.html }} />
      )}
      {editing && (
        <div className="block-math-editor" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          <textarea
            ref={textareaRef}
            className="block-math-editor-input"
            value={draft}
            spellCheck={false}
            placeholder="e^{i\pi} + 1 = 0  (Mod-Enter to apply, Escape to cancel)"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(false)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                commit(true)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
          />
          <div className="block-math-editor-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />
          {preview.error && <div className="block-math-editor-error">{preview.error}</div>}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      latex: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="block-math"]',
        getAttrs: (el) => ({
          latex: (el as HTMLElement).getAttribute('data-latex') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'block-math' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockMathView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: BlockMathAttrs }) {
          const s = state as { write: (str: string) => void; ensureNewLine: () => void; closeBlock: (n: unknown) => void }
          s.write('$\n')
          s.write(node.attrs.latex)
          s.ensureNewLine()
          s.write('$')
          s.closeBlock(node)
        },
        parse: {
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
            markdownit.block.ruler.before('fence', 'block_math', (state: unknown, startLine: number, endLine: number, silent: boolean): boolean => {
              const st = state as {
                src: string
                bMarks: number[]
                eMarks: number[]
                tShift: number[]
                tokens: Array<{ type: string; content: string; map: [number, number]; level: number }>
                line: number
                level: number
                push: (type: string, tag: string, nesting: number) => { content: string; map: [number, number]; level: number }
              }

              const pos = (st.bMarks[startLine] ?? 0) + (st.tShift[startLine] ?? 0)
              const max = st.eMarks[startLine] ?? 0
              const line = st.src.slice(pos, max).trim()

              if (line !== '$') return false
              if (silent) return true

              let nextLine = startLine + 1
              let found = false
              while (nextLine < endLine) {
                const npos = (st.bMarks[nextLine] ?? 0) + (st.tShift[nextLine] ?? 0)
                const nmax = st.eMarks[nextLine] ?? 0
                if (st.src.slice(npos, nmax).trim() === '$') {
                  found = true
                  break
                }
                nextLine++
              }

              if (!found) return false

              const latex = st.src
                .slice(st.bMarks[startLine + 1], st.eMarks[nextLine - 1])
                .trim()

              const token = st.push('html_block', '', 0)
              token.content = `<div data-type="block-math" data-latex="${encodeAttr(latex)}"></div>\n`
              token.map = [startLine, nextLine + 1]
              token.level = st.level

              st.line = nextLine + 1
              return true
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
