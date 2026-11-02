import { lazy, Suspense, useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { diagramApi } from '../../lib/diagram'
import { sanitizeNoteHtml } from '../../lib/sanitizeHtml'
import { writeToClipboard } from '../../lib/clipboard'
import { encodeSrc } from './NoteImage'
import { FigureNumberInput } from '../../components/FigureNumberInput'
import { OcclusionDialog } from '../../components/OcclusionDialog'
import { insertOcclusionCards } from '../occlusionCards'
import type { OcclusionRect } from '../../lib/occlusion'

// Dynamically imported so @excalidraw/excalidraw (a multi-MB bundle) only
// loads once a diagram is actually opened for editing — a note that never
// opens one, and any test that only mounts the static preview, never pays
// for it.
const DiagramEditorOverlay = lazy(() =>
  import('./DiagramEditorOverlay').then((m) => ({ default: m.DiagramEditorOverlay })),
)

interface DiagramBlockAttrs {
  jsonSrc: string
  svgSrc: string
  width: number
  height: number
  number: string | null
}

// A card's front/back is a plain text line (see extract_cards, notes.rs),
// so a diagram can't be embedded as a card the way its own multi-line
// ```diagram fence is — but the same `![alt](path)` an image card already
// uses works unmodified for any note-relative path (read_note_asset just
// joins it onto the note's directory, it isn't `.assets`-specific). This
// converts the block's absolute svgSrc back to that note-relative form.
export function relativeToNoteDir(notePath: string, absolutePath: string): string | null {
  const sep = notePath.includes('\\') ? '\\' : '/'
  const dirEnd = notePath.lastIndexOf(sep)
  if (dirEnd === -1) return null
  const prefix = notePath.slice(0, dirEnd) + sep
  if (!absolutePath.startsWith(prefix)) return null
  return absolutePath.slice(prefix.length).split('\\').join('/')
}

function DiagramBlockView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  // width/height are stored (see DiagramBlockAttrs below) but intentionally
  // not applied here — the preview sizes itself to the actual exported SVG's
  // own dimensions (see .diagram-block-preview svg's max-width/height:auto
  // in index.css), the same way MermaidBlock's rendered SVG does. A diagram
  // whose drawn content is much smaller than the block's nominal box used to
  // force a large empty region below the visible shapes.
  const { jsonSrc, svgSrc, number } = node.attrs as unknown as DiagramBlockAttrs
  const notePath = editor.storage.noteContext.notePath
  const [svg, setSvg] = useState('')
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [authoring, setAuthoring] = useState(false)
  const relativeSvg = relativeToNoteDir(notePath, svgSrc)

  function createCards(rects: OcclusionRect[]) {
    const pos = getPos()
    if (pos === undefined || !relativeSvg) return
    insertOcclusionCards(editor, pos + node.nodeSize, relativeSvg, 'diagram', rects)
    setAuthoring(false)
  }

  useEffect(() => {
    let cancelled = false
    diagramApi
      .read(svgSrc)
      .then((text) => {
        if (!cancelled) setSvg(text)
      })
      .catch(() => {
        if (!cancelled) setSvg('')
      })
    return () => {
      cancelled = true
    }
  }, [svgSrc])

  // insertDiagram dispatches this immediately after inserting a brand-new,
  // empty diagram — an empty scene has no useful static preview to land on,
  // so it jumps straight to the editor instead. Matched on jsonSrc so only
  // the node that was actually just inserted opens.
  useEffect(() => {
    function onAutoOpen(event: Event) {
      const detail = (event as CustomEvent<{ jsonSrc: string }>).detail
      if (detail.jsonSrc === jsonSrc) setEditing(true)
    }
    window.addEventListener('diagram:auto-open', onAutoOpen)
    return () => window.removeEventListener('diagram:auto-open', onAutoOpen)
  }, [jsonSrc])

  if (!jsonSrc) return <NodeViewWrapper className="diagram-block" />

  return (
    <NodeViewWrapper className="diagram-block" data-number={number ?? undefined}>
      {/* The .diagrams/*.svg sidecar is normally only ever written by
          exportToSvg below, but it's still a file on disk inside a workspace
          that can be shared/synced — same trust boundary as a note's own
          .md content (the class of issue H-3's mermaid fix addressed), so it
          gets the same sanitizing pass as HTMLBlock/mermaid's SVG output. */}
      {/* eslint-disable-next-line react/no-danger */}
      <div className="diagram-block-preview" dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(svg) || '<svg></svg>' }} />
      <div className="diagram-block-actions">
        {relativeToNoteDir(notePath, svgSrc) && (
          <button
            type="button"
            className={`diagram-block-copy${copied ? ' copied' : ''}`}
            aria-label="Copy diagram as flashcard reference"
            title="Copy as flashcard reference"
            onClick={() => {
              const relative = relativeToNoteDir(notePath, svgSrc)
              if (!relative) return
              void writeToClipboard(`![diagram](${encodeSrc(relative)})`).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy for card'}
          </button>
        )}
        {editor.isEditable && relativeSvg && svg && (
          <button type="button" className="diagram-block-occlusion" onClick={() => setAuthoring(true)}>
            Occlusion cards
          </button>
        )}
        {editor.isEditable && <FigureNumberInput number={number} onCommit={(next) => updateAttributes({ number: next })} />}
        {editor.isEditable && (
          <button type="button" className="diagram-block-edit" aria-label="Edit diagram" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      {authoring && relativeSvg && (
        <OcclusionDialog
          notePath={notePath}
          src={relativeSvg}
          onConfirm={createCards}
          onClose={() => setAuthoring(false)}
        />
      )}
      {editing && (
        <Suspense fallback={null}>
          <DiagramEditorOverlay
            jsonSrc={jsonSrc}
            svgSrc={svgSrc}
            onClose={(newSvg) => {
              setSvg(newSvg)
              setEditing(false)
            }}
          />
        </Suspense>
      )}
    </NodeViewWrapper>
  )
}

export const DiagramBlock = Node.create({
  name: 'diagramBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      jsonSrc: { default: null },
      svgSrc: { default: null },
      width: { default: 700 },
      height: { default: 500 },
      number: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="diagram-block"]',
        getAttrs: (el) => ({
          jsonSrc: (el as HTMLElement).getAttribute('data-json-src'),
          svgSrc: (el as HTMLElement).getAttribute('data-svg-src'),
          width: parseInt((el as HTMLElement).getAttribute('data-width') ?? '700', 10),
          height: parseInt((el as HTMLElement).getAttribute('data-height') ?? '500', 10),
          number: (el as HTMLElement).getAttribute('data-number') || null,
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'diagram-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DiagramBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: DiagramBlockAttrs }) {
          const { jsonSrc, svgSrc, width, height, number } = node.attrs
          const s = state as {
            write: (str: string) => void
            ensureNewLine: () => void
            closeBlock: (n: unknown) => void
          }
          s.write('```diagram\n')
          s.write(JSON.stringify({ jsonSrc, svgSrc, width, height, ...(number ? { number } : {}) }))
          s.ensureNewLine()
          s.write('```')
          s.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll<HTMLElement>('pre > code.language-diagram').forEach((code) => {
              const pre = code.parentElement
              if (!pre) return
              try {
                const data = JSON.parse(code.textContent ?? '{}') as Partial<DiagramBlockAttrs>
                const div = document.createElement('div')
                div.setAttribute('data-type', 'diagram-block')
                div.setAttribute('data-json-src', data.jsonSrc ?? '')
                div.setAttribute('data-svg-src', data.svgSrc ?? '')
                div.setAttribute('data-width', String(data.width ?? 700))
                div.setAttribute('data-height', String(data.height ?? 500))
                if (data.number) div.setAttribute('data-number', data.number)
                pre.replaceWith(div)
              } catch {
                // invalid JSON — leave as-is
              }
            })
          },
        },
      },
    }
  },
})
