import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useId, useRef, useState } from 'react'

// Mermaid is ~700 KB of source; most notes have no diagram, so it loads on the
// first block that renders rather than at app start.
let mermaidReady: Promise<typeof import('mermaid').default> | null = null
function loadMermaid() {
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, theme: 'default' })
    return mermaid
  })
  return mermaidReady
}

interface MermaidAttrs {
  code: string
}

function MermaidView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const { code } = node.attrs as unknown as MermaidAttrs
  const uid = useId().replace(/[^a-z0-9]/gi, '')
  const id = `md${uid}`
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(code)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setError(false)
    if (!code.trim()) return
    loadMermaid()
      .then((mermaid) => mermaid.render(id, code))
      .then(({ svg: out }) => setSvg(out))
      .catch(() => setError(true))
  }, [code, id])

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  function open() {
    if (!editor.isEditable) return
    setDraft(code)
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const next = draft.trim()
    if (next !== code) updateAttributes({ code: next })
  }

  function cancel() {
    setDraft(code)
    setEditing(false)
  }

  return (
    <NodeViewWrapper className="mermaid-block" spellCheck={false}>
      {editing ? (
        <textarea
          ref={textareaRef}
          className="mermaid-block-editor"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
        />
      ) : (
        <div className="mermaid-block-preview" onClick={open}>
          {svg && !error ? (
            // Mermaid's own rendered output (H-3 fixed the raw-source fallback
            // below, not this).
            // eslint-disable-next-line react/no-danger
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <pre className={error ? 'mermaid-error' : undefined}>{code}</pre>
          )}
          {editor.isEditable && (
            <div className="diagram-block-actions">
              <button type="button" className="diagram-block-edit" aria-label="Edit diagram" onClick={open}>
                Edit
              </button>
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaid-block"]',
        getAttrs: (el) => ({
          code: (el as HTMLElement).getAttribute('data-code') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'mermaid-block' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: MermaidAttrs }) {
          const s = state as {
            write: (str: string) => void
            ensureNewLine: () => void
            closeBlock: (n: unknown) => void
          }
          s.write('```mermaid\n')
          s.write(node.attrs.code)
          s.ensureNewLine()
          s.write('```')
          s.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll<HTMLElement>('pre > code.language-mermaid').forEach((code) => {
              const pre = code.parentElement
              if (!pre) return
              const div = document.createElement('div')
              div.setAttribute('data-type', 'mermaid-block')
              div.setAttribute('data-code', code.textContent ?? '')
              pre.replaceWith(div)
            })
          },
        },
      },
    }
  },
})
