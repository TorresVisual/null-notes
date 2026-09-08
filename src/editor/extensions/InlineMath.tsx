import { Node, InputRule } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useId, useRef, useState } from 'react'
import { renderMath } from '../../lib/mathRender'
import { encodeAttr } from '../../lib/htmlAttr'
import { commitUnlessFocusLeaves } from '../../lib/mathEditorFocus'
import { insertSymbolAt } from '../../lib/mathSymbols'
import { useMathSnippetMenu } from '../../hooks/useMathSnippetMenu'
import { useMathEditorStore } from '../../store/mathEditor'
import { MathSnippetMenu } from './MathSnippetMenu'
import { MathCopyButton } from './MathCopyButton'
import { MathErrorOverlay } from './MathErrorOverlay'

interface InlineMathAttrs {
  latex: string
}

function InlineMathView({ node, editor, getPos, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const { latex } = node.attrs as unknown as InlineMathAttrs
  // A node inserted from the slash menu or shortcut arrives empty; it has
  // nothing to show, so it opens straight into the editor.
  const [editing, setEditing] = useState(() => editor.isEditable && latex === '')
  const [draft, setDraft] = useState(latex)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const snippetMenu = useMathSnippetMenu(draft, cursor, setDraft, inputRef)

  const editorId = useId()
  const setActiveMathEditor = useMathEditorStore((s) => s.setActiveEditor)
  const clearActiveMathEditor = useMathEditorStore((s) => s.clearActiveEditor)
  // Read fresh inside the registered handle without making the registration
  // effect re-run (and thus re-register) on every keystroke or render.
  const draftRef = useRef(draft)
  draftRef.current = draft
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const commitRef = useRef<(refocus: boolean) => void>(() => {})

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  // The symbol palette lives in the top toolbar (P12-4 follow-up), outside
  // this node view entirely — this is the only path back into its local
  // (draft, cursor) state, the same shape `ink.ts`'s `CanvasHandle`
  // registration already uses for the toolbar's undo/redo/zoom controls.
  useEffect(() => {
    if (!editing) return
    setActiveMathEditor(editorId, {
      insertSymbol: (latex) => {
        const result = insertSymbolAt(draftRef.current, cursorRef.current, latex)
        setDraft(result.text)
        setCursor(result.cursor)
        requestAnimationFrame(() => {
          inputRef.current?.focus()
          inputRef.current?.setSelectionRange(result.cursor, result.cursor)
        })
      },
      commitAndClose: () => commitRef.current(false),
    })
    return () => clearActiveMathEditor(editorId)
  }, [editing, editorId, setActiveMathEditor, clearActiveMathEditor])

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
  commitRef.current = commit

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

  const display = renderMath(latex, false)
  const preview = renderMath(draft, false)

  return (
    <NodeViewWrapper
      as="span"
      className={`inline-math${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      spellCheck={false}
    >
      <span
        className="inline-math-render"
        onClick={open}
        tabIndex={editor.isEditable ? 0 : undefined}
        role="button"
        aria-label="Edit equation"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          open()
        }}
        // KaTeX's own rendered output, not note-derived HTML.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: display.html }}
      />
      {editing && (
        <span className="math-editor" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          <span className="math-snippet-anchor">
            <span className="math-input-wrap">
              <input
                ref={inputRef}
                className="math-editor-input"
                value={draft}
                spellCheck={false}
                placeholder="e^{i\pi} + 1 = 0, or /gradient for a snippet"
                onChange={(e) => {
                  setDraft(e.target.value)
                  setCursor(e.target.selectionStart ?? e.target.value.length)
                }}
                onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
                onKeyUp={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
                onBlur={() => commitUnlessFocusLeaves(commit)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (snippetMenu.handleKeyDown(e)) return
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit(true)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancel()
                  }
                }}
              />
              <MathErrorOverlay
                as="span"
                latex={draft}
                errorPosition={preview.errorPosition}
                errorLength={preview.errorLength}
                className="math-editor-input"
              />
            </span>
            <MathSnippetMenu
              matches={snippetMenu.matches}
              selected={snippetMenu.selected}
              onSelect={snippetMenu.select}
            />
          </span>
          <MathCopyButton latex={draft} className="math-copy-button" />
          {/* eslint-disable-next-line react/no-danger -- KaTeX's own rendered output, not note-derived HTML. */}
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
          // An *inline*-ruler rule, not a core-ruler post-process: markdown-it's
          // own text/escape rules already run inside the built-in "inline" core
          // rule, before any custom core rule ever sees `token.children`. A
          // core-ruler rule (the previous approach here) inspects text that has
          // already been through CommonMark's backslash-escape processing —
          // and `\\` is itself a valid CommonMark escape for a literal `\`, so
          // a LaTeX matrix/cases row separator (or `\{`, `\_`, `\%`, …) silently
          // lost one backslash before this node's own parsing ever ran. Hooking
          // in *before* the built-in `escape` rule, and reading straight from
          // `state.src`, claims the raw span first — the same reasoning
          // `BlockMath.tsx`'s block-level rule already follows by reading
          // `state.src` directly instead of post-processing tokens.
          setup(markdownit: {
            inline: {
              ruler: {
                before: (ref: string, name: string, fn: (state: unknown, silent: boolean) => boolean) => void
              }
            }
          }) {
            markdownit.inline.ruler.before('escape', 'inline_math', (state: unknown, silent: boolean): boolean => {
              const st = state as {
                src: string
                pos: number
                posMax: number
                push: (type: string, tag: string, nesting: number) => { content: string }
              }

              if (st.src.charCodeAt(st.pos) !== 0x24 /* $ */) return false

              const max = st.posMax
              let pos = st.pos + 1
              while (pos < max) {
                const code = st.src.charCodeAt(pos)
                if (code === 0x24 /* $ */) break
                if (code === 0x0a /* \n */) return false
                pos++
              }
              // No closing `$` on this line, or nothing between the two — a
              // lone dollar sign is a price, not the start of an equation,
              // matching the previous regex's `{1,200}` (at least one char).
              if (pos >= max || st.src.charCodeAt(pos) !== 0x24) return false
              const len = pos - st.pos - 1
              if (len < 1 || len > 200) return false

              if (!silent) {
                const latex = st.src.slice(st.pos + 1, pos)
                const token = st.push('html_inline', '', 0)
                token.content = `<span data-type="inline-math" data-latex="${encodeAttr(latex)}"></span>`
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

