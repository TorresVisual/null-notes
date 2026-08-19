import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import katex from 'katex'
import { useMathSnippetMenu } from '../../hooks/useMathSnippetMenu'
import { MathSnippetMenu } from './MathSnippetMenu'

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
  const [cursor, setCursor] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const snippetMenu = useMathSnippetMenu(draft, cursor, setDraft, textareaRef)

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
          <div className="math-snippet-anchor">
            <textarea
              ref={textareaRef}
              className="block-math-editor-input"
              value={draft}
              spellCheck={false}
              placeholder="e^{i\pi} + 1 = 0  (Mod-Enter to apply, Escape to cancel, / for a snippet)"
              onChange={(e) => {
                setDraft(e.target.value)
                setCursor(e.target.selectionStart ?? e.target.value.length)
              }}
              onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
              onKeyUp={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
              onBlur={() => commit(false)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (snippetMenu.handleKeyDown(e)) return
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  commit(true)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancel()
                }
              }}
            />
            <MathSnippetMenu
              matches={snippetMenu.matches}
              selected={snippetMenu.selected}
              onSelect={snippetMenu.select}
            />
          </div>
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
          // Parsed liberally, serialized conservatively. This app writes a lone
          // `$` on its own line, but Obsidian, Notion, GitHub and plain LaTeX
          // habit all write `$$` — and a note typed by hand or edited outside
          // the app arrives in that dialect. Both are read; only the lone `$`
          // is ever written back.
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

              const found = onOneLine(line, startLine) ?? acrossLines(st, line, startLine, endLine)
              if (!found) return false

              // Everything above has to be settled before this returns: in
              // silent mode markdown-it is asking whether this line ends the
              // paragraph above, and saying yes to an unclosed fence would cut
              // that paragraph in half and render neither half as maths.
              if (silent) return true

              const token = st.push('html_block', '', 0)
              token.content = `<div data-type="block-math" data-latex="${encodeAttr(found.latex)}"></div>\n`
              token.map = [startLine, found.lastLine + 1]
              token.level = st.level

              st.line = found.lastLine + 1
              return true
            }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
          },
        },
      },
    }
  },
})

function encodeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface Fence {
  latex: string
  lastLine: number
}

/** `$$e^{i\pi} + 1 = 0$$`, opened and closed on the line it occupies. */
function onOneLine(line: string, startLine: number): Fence | null {
  if (!line.startsWith('$$') || !line.endsWith('$$') || line.length <= 4) return null
  const latex = line.slice(2, -2).trim()
  return latex ? { latex, lastLine: startLine } : null
}

/** A `$` or `$$` fence line, its content, and the same marker closing it. */
function acrossLines(
  st: { src: string; bMarks: number[]; eMarks: number[]; tShift: number[] },
  line: string,
  startLine: number,
  endLine: number,
): Fence | null {
  if (line !== '$' && line !== '$$') return null

  for (let next = startLine + 1; next < endLine; next++) {
    const from = (st.bMarks[next] ?? 0) + (st.tShift[next] ?? 0)
    const to = st.eMarks[next] ?? 0
    // A fence closes on the marker it opened with: guessing which half of a
    // mismatched pair was meant would swallow the rest of the note.
    if (st.src.slice(from, to).trim() !== line) continue

    const latex = st.src.slice(st.bMarks[startLine + 1], st.eMarks[next - 1]).trim()
    return latex ? { latex, lastLine: next } : null
  }
  return null
}
