import { lazy, Suspense, useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { diagramApi } from '../../lib/diagram'

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
}

function DiagramBlockView({ node }: ReactNodeViewProps) {
  // width/height are stored (see DiagramBlockAttrs below) but intentionally
  // not applied here — the preview sizes itself to the actual exported SVG's
  // own dimensions (see .diagram-block-preview svg's max-width/height:auto
  // in index.css), the same way MermaidBlock's rendered SVG does. A diagram
  // whose drawn content is much smaller than the block's nominal box used to
  // force a large empty region below the visible shapes.
  const { jsonSrc, svgSrc } = node.attrs as unknown as DiagramBlockAttrs
  const [svg, setSvg] = useState('')
  const [editing, setEditing] = useState(false)

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
    <NodeViewWrapper className="diagram-block">
      <div className="diagram-block-preview" dangerouslySetInnerHTML={{ __html: svg || '<svg></svg>' }} />
      <button type="button" className="diagram-block-edit" aria-label="Edit diagram" onClick={() => setEditing(true)}>
        Edit
      </button>
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
          const { jsonSrc, svgSrc, width, height } = node.attrs
          const s = state as {
            write: (str: string) => void
            ensureNewLine: () => void
            closeBlock: (n: unknown) => void
          }
          s.write('```diagram\n')
          s.write(JSON.stringify({ jsonSrc, svgSrc, width, height }))
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
