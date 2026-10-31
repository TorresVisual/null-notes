import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useState } from 'react'
import { moveSelectionOutOf } from './collapseSelection'
import {
  ChevronRight,
  ClipboardList,
  ListChecks,
  Check,
  CircleHelp,
  X,
  Bug,
  Quote,
  Info,
  Lightbulb,
  TriangleAlert,
  CircleX,
  Star,
  BookOpen,
  Puzzle,
  GitBranch,
  CheckCircle2,
  BookMarked,
  FlaskConical,
  Cpu,
} from 'lucide-react'

// Obsidian's aliases resolve to a canonical type for label/icon/colour; the
// attribute itself keeps what the note said, so nothing is rewritten on save.
const CALLOUT_ALIAS: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
}

interface CalloutAttrs {
  calloutType: string
  /** The type exactly as written in the marker (`Custom`, `note`); empty for blocks created in the editor. */
  rawType: string
  title: string
  number: string
  /** `+` open / `-` closed fold marker, or null when not foldable. */
  foldable: '+' | '-' | null
}

const CALLOUT_LABEL: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
  info: 'Info',
  important: 'Important',
  theorem: 'Theorem',
  lemma: 'Lemma',
  corollary: 'Corollary',
  proof: 'Proof',
  definition: 'Definition',
  example: 'Example',
  algorithm: 'Algorithm',
  abstract: 'Abstract',
  todo: 'Todo',
  success: 'Success',
  question: 'Question',
  failure: 'Failure',
  bug: 'Bug',
  quote: 'Quote',
}

const CALLOUT_ICON: Record<string, typeof Info> = {
  note: Info,
  info: Info,
  tip: Lightbulb,
  warning: TriangleAlert,
  danger: CircleX,
  important: Star,
  theorem: BookOpen,
  lemma: Puzzle,
  corollary: GitBranch,
  proof: CheckCircle2,
  definition: BookMarked,
  example: FlaskConical,
  algorithm: Cpu,
  abstract: ClipboardList,
  todo: ListChecks,
  success: Check,
  question: CircleHelp,
  failure: X,
  bug: Bug,
  quote: Quote,
}

// Proof/theorem-family blocks carry an optional user-assigned number
// ("3.2") alongside the type — P6-7's cross-references resolve a bare
// "Theorem 3.2" in prose against this, so the number is real content, not
// styling, and lives in the header next to the label rather than in title.
function CalloutView({ node, editor, getPos }: ReactNodeViewProps) {
  const { calloutType, title, number, foldable } = node.attrs as unknown as CalloutAttrs
  // Open/closed is view state like Details' — toggling must not dirty the
  // buffer; the stored `foldable` marker only seeds the initial state.
  const [open, setOpen] = useState(foldable !== '-')
  const kind = CALLOUT_ALIAS[calloutType] ?? calloutType
  const Icon = CALLOUT_ICON[kind] ?? Info
  const label = CALLOUT_LABEL[kind] ?? calloutType.toUpperCase()

  function toggle() {
    if (open) {
      const pos = getPos()
      if (pos !== undefined) moveSelectionOutOf(editor, pos, node.nodeSize)
    }
    setOpen(!open)
  }

  return (
    <NodeViewWrapper
      className={`callout callout-${kind}${foldable ? ` callout-foldable${open ? ' open' : ''}` : ''}`}
      data-callout-type={calloutType}
      data-callout-number={number}
    >
      <div
        className="callout-header"
        contentEditable={false}
        onMouseDown={foldable ? (e) => e.stopPropagation() : undefined}
        onClick={foldable ? toggle : undefined}
      >
        <Icon size={13} />
        <span className="callout-label">{number ? `${label} ${number}` : label}</span>
        {title && <span className="callout-title">{title}</span>}
        {foldable && <ChevronRight size={13} className="callout-chevron" />}
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
      rawType: { default: '' },
      title: { default: '' },
      number: { default: '' },
      foldable: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: (el) => ({
          calloutType: (el as HTMLElement).getAttribute('data-callout-type') ?? 'note',
          rawType: (el as HTMLElement).getAttribute('data-callout-raw-type') ?? '',
          foldable: (el as HTMLElement).getAttribute('data-callout-foldable') || null,
          title: (el as HTMLElement).getAttribute('data-callout-title') ?? '',
          number: (el as HTMLElement).getAttribute('data-callout-number') ?? '',
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
          const type = node.attrs.rawType || (node.attrs.calloutType ?? 'note').toUpperCase()
          const number = node.attrs.number as string
          const title = node.attrs.title as string
          const marker = number ? `${type} ${number}` : type
          const fold = node.attrs.foldable ?? ''
          const firstDelim = title ? `> [!${marker}]${fold} ${title}\n> ` : `> [!${marker}]${fold}\n> `
          s.wrapBlock('> ', firstDelim, node, () => s.renderContent(node))
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('blockquote').forEach((bq) => {
              const firstP = bq.querySelector(':scope > p:first-child')
              if (!firstP) return
              const rawText = firstP.textContent ?? ''
              const newlineIdx = rawText.indexOf('\n')
              const markerLine = (newlineIdx === -1 ? rawText : rawText.slice(0, newlineIdx)).trim()
              const match = /^\[!([\w-]+)(?:\s+([\w.]+))?\]([+-])?(.*)/.exec(markerLine)
              if (!match) return
              const calloutType = match[1]!.toLowerCase()
              const number = match[2] ?? ''
              const foldable = match[3] ?? ''
              const title = match[4]?.trim() ?? ''
              const div = document.createElement('div')
              div.setAttribute('data-type', 'callout')
              div.setAttribute('data-callout-type', calloutType)
              div.setAttribute('data-callout-raw-type', match[1]!)
              div.setAttribute('data-callout-foldable', foldable)
              div.setAttribute('data-callout-title', title)
              div.setAttribute('data-callout-number', number)

              // A blockquote line right under the marker with no blank line
              // between them is the *same* Markdown paragraph as the marker
              // (a soft line break), not a separate one — strip only the
              // marker line's own characters from the DOM and leave whatever
              // follows (with its inline formatting intact) as the callout's
              // first body paragraph. Deleting the whole paragraph here was a
              // real content-loss bug: any body text glued to the marker line
              // vanished silently on every save.
              const markerLen = newlineIdx === -1 ? rawText.length : newlineIdx + 1
              let consumed = 0
              for (const child of Array.from(firstP.childNodes)) {
                if (consumed >= markerLen) break
                const len = child.textContent?.length ?? 0
                if (consumed + len <= markerLen) {
                  child.remove()
                  consumed += len
                } else if (child.nodeType === 3 /* Node.TEXT_NODE — `Node` above is TipTap's, not the DOM's */) {
                  ;(child as Text).deleteData(0, markerLen - consumed)
                  consumed = markerLen
                } else {
                  consumed = markerLen
                }
              }
              if (!firstP.textContent?.trim()) firstP.remove()

              while (bq.firstChild) div.appendChild(bq.firstChild)
              bq.replaceWith(div)
            })
          },
        },
      },
    }
  },
})
