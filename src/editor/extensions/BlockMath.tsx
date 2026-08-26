import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { renderMath } from '../../lib/mathRender'
import { useMathSnippetMenu } from '../../hooks/useMathSnippetMenu'
import { MathSnippetMenu } from './MathSnippetMenu'
import { MathCopyButton } from './MathCopyButton'
import { MathErrorOverlay } from './MathErrorOverlay'

interface BlockMathAttrs {
  latex: string
  /** P12-2: `Equation (3)` cross-references resolve against this, the same
   *  numbering pattern P6-1 gave `Callout`. `null` (not `''`) means unnumbered. */
  number: string | null
}

// The editing overlay now has two focusable fields (latex, number) instead
// of one — moving focus *between* them must not count as "leaving" the
// editor. Without this, clicking from the latex textarea into the number
// field blurs the textarea, which commits with whatever the number field
// held *before* the user had a chance to type into it, and closes the
// whole editor out from under the click.
//
// Deliberately not `event.relatedTarget`: it's the standard way to ask
// "where did focus go", but it isn't reliably populated for every
// focus-shift path (least of all in jsdom, this codebase's test
// environment) — the robust version of this check is the same
// setTimeout-deferred `document.activeElement` read most component
// libraries use for exactly this "did focus leave the whole widget"
// question, since by the next tick the browser has always settled on
// wherever focus actually landed.
function commitUnlessFocusStaysInEditor(editorField: HTMLElement, commit: (refocus: boolean) => void): void {
  const editorEl = editorField.closest('.block-math-editor')
  setTimeout(() => {
    if (editorEl?.contains(document.activeElement)) return
    commit(false)
  }, 0)
}

function BlockMathView({ node, editor, getPos, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const { latex, number } = node.attrs as unknown as BlockMathAttrs
  const [editing, setEditing] = useState(() => editor.isEditable && latex === '')
  const [draft, setDraft] = useState(latex)
  const [draftNumber, setDraftNumber] = useState(number ?? '')
  const [cursor, setCursor] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const snippetMenu = useMathSnippetMenu(draft, cursor, setDraft, textareaRef)

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  function open() {
    if (!editor.isEditable) return
    setDraft(latex)
    setDraftNumber(number ?? '')
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
    updateAttributes({ latex: next, number: draftNumber.trim() || null })
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
    setDraftNumber(number ?? '')
    close(true)
  }

  const display = renderMath(latex, true)
  const preview = renderMath(draft, true)

  return (
    <NodeViewWrapper
      className={`block-math${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      data-type="block-math"
      data-number={number ?? undefined}
      spellCheck={false}
    >
      {!editing && (
        <div className="block-math-row">
          <div
            className="block-math-render"
            onClick={open}
            tabIndex={editor.isEditable ? 0 : undefined}
            role="button"
            aria-label="Edit equation"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              open()
            }}
            dangerouslySetInnerHTML={{ __html: display.html }}
          />
          {number && <span className="block-math-number">({number})</span>}
        </div>
      )}
      {editing && (
        <div className="block-math-editor" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          <div className="math-snippet-anchor">
            <div className="block-math-input-wrap">
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
                onBlur={(e) => commitUnlessFocusStaysInEditor(e.currentTarget, commit)}
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
              <MathErrorOverlay
                latex={draft}
                errorPosition={preview.errorPosition}
                errorLength={preview.errorLength}
                className="block-math-editor-input"
              />
            </div>
            <input
              type="text"
              className="block-math-number-input"
              value={draftNumber}
              placeholder="№"
              title="Equation number (optional) — makes it resolvable as Equation (N)"
              onChange={(e) => setDraftNumber(e.target.value)}
              onBlur={(e) => commitUnlessFocusStaysInEditor(e.currentTarget, commit)}
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
            <MathCopyButton latex={draft} className="math-copy-button" />
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
      number: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="block-math"]',
        getAttrs: (el) => ({
          latex: (el as HTMLElement).getAttribute('data-latex') ?? '',
          number: (el as HTMLElement).getAttribute('data-number') || null,
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const number = (node.attrs as BlockMathAttrs).number
    return ['div', { ...HTMLAttributes, 'data-type': 'block-math', ...(number ? { 'data-number': number } : {}) }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockMathView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: BlockMathAttrs }) {
          const s = state as { write: (str: string) => void; ensureNewLine: () => void; closeBlock: (n: unknown) => void }
          // A numbered equation's opening fence carries its number directly
          // (`$3`), no space — the same line P12-2's cross-reference lookup
          // greps for via `equation_marker_like_pattern`. The closing fence
          // stays a bare `$`, matching `acrossLines`' expectation below.
          s.write(`$${node.attrs.number ?? ''}\n`)
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
              const numberAttr = found.number ? ` data-number="${encodeAttr(found.number)}"` : ''
              token.content = `<div data-type="block-math" data-latex="${encodeAttr(found.latex)}"${numberAttr}></div>\n`
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
  number: string | null
}

/** `$$e^{i\pi} + 1 = 0$$`, opened and closed on the line it occupies. No
 *  numbering here — a quick inline-style display equation, not the
 *  "formal, referenceable" shape numbering is for; `acrossLines` below is
 *  the one form P12-2 gave that. */
function onOneLine(line: string, startLine: number): Fence | null {
  if (!line.startsWith('$$') || !line.endsWith('$$') || line.length <= 4) return null
  const latex = line.slice(2, -2).trim()
  return latex ? { latex, lastLine: startLine, number: null } : null
}

// Fence chars (`$` or `$$`) with an optional trailing number: `$`, `$$`,
// `$3`, `$$3.2`. The closing line must repeat only the fence *characters*
// (never the number) — see the loop below.
const FENCE_LINE = /^(\${1,2})(\d+(?:\.\d+)*)?$/

/** A `$`/`$$` fence line (optionally numbered), its content, and the plain
 *  fence-character line that closes it. */
function acrossLines(
  st: { src: string; bMarks: number[]; eMarks: number[]; tShift: number[] },
  line: string,
  startLine: number,
  endLine: number,
): Fence | null {
  const match = FENCE_LINE.exec(line)
  if (!match) return null
  const fence = match[1]
  const number = match[2] ?? null

  for (let next = startLine + 1; next < endLine; next++) {
    const from = (st.bMarks[next] ?? 0) + (st.tShift[next] ?? 0)
    const to = st.eMarks[next] ?? 0
    // A fence closes on the bare marker it opened with (never repeating the
    // number): guessing which half of a mismatched pair was meant would
    // swallow the rest of the note.
    if (st.src.slice(from, to).trim() !== fence) continue

    const latex = st.src.slice(st.bMarks[startLine + 1], st.eMarks[next - 1]).trim()
    return latex ? { latex, lastLine: next, number } : null
  }
  return null
}
