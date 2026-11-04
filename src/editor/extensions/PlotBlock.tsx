import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parsePlotSource, samplePlot, yBounds } from '../../lib/plot'

interface PlotAttrs {
  code: string
}

const W = 560
const H = 300
const SERIES_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea']

function PlotSvg({ code }: { code: string }) {
  const { series, xMin, xMax, yMin, yMax } = useMemo(() => {
    const spec = parsePlotSource(code)
    const series = samplePlot(spec)
    const [yMin, yMax] = yBounds(series)
    return { series, xMin: spec.xMin, xMax: spec.xMax, yMin, yMax }
  }, [code])

  const px = (x: number) => ((x - xMin) / (xMax - xMin)) * W
  const py = (y: number) => H - ((y - yMin) / (yMax - yMin)) * H
  const axisX = Math.min(Math.max(px(0), 0), W)
  const axisY = Math.min(Math.max(py(0), 0), H)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="plot-block-svg" role="img" aria-label={`Plot of ${series.map((s) => s.expr).join(', ')}`}>
      <line x1={0} x2={W} y1={axisY} y2={axisY} className="plot-axis" />
      <line x1={axisX} x2={axisX} y1={0} y2={H} className="plot-axis" />
      <text x={4} y={12} className="plot-label">{+yMax.toPrecision(3)}</text>
      <text x={4} y={H - 4} className="plot-label">{+yMin.toPrecision(3)}</text>
      <text x={W - 4} y={axisY - 4} textAnchor="end" className="plot-label">{xMax}</text>
      <text x={4} y={axisY - 4} className="plot-label">{xMin}</text>
      {series.map((s, i) => {
        let d = ''
        let pen = false
        for (const p of s.points) {
          const inView = p !== null && p[1] >= yMin && p[1] <= yMax
          if (!inView) {
            pen = false
            continue
          }
          d += `${pen ? 'L' : 'M'}${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`
          pen = true
        }
        return <path key={i} d={d} fill="none" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} />
      })}
    </svg>
  )
}

function PlotView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const { code } = node.attrs as unknown as PlotAttrs
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(code)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const exprs = useMemo(() => parsePlotSource(code).exprs, [code])
  const failed = useMemo(() => samplePlot(parsePlotSource(code)).filter((s) => s.error), [code])

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

  return (
    <NodeViewWrapper className="plot-block" spellCheck={false}>
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
              setDraft(code)
              setEditing(false)
            }
          }}
        />
      ) : (
        <div className="mermaid-block-preview" onClick={open}>
          {exprs.length > 0 ? <PlotSvg code={code} /> : <pre>Click to add an expression, e.g. x^2</pre>}
          {failed.length > 0 && (
            <div className="mermaid-error">Cannot plot: {failed.map((s) => s.expr).join(', ')}</div>
          )}
          {editor.isEditable && (
            <div className="diagram-block-actions">
              <button type="button" className="diagram-block-edit" aria-label="Edit plot" onClick={open}>
                Edit
              </button>
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const PlotBlock = Node.create({
  name: 'plotBlock',
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
        tag: 'div[data-type="plot-block"]',
        getAttrs: (el) => ({
          code: (el as HTMLElement).getAttribute('data-code') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'plot-block' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlotView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: PlotAttrs }) {
          const s = state as {
            write: (str: string) => void
            ensureNewLine: () => void
            closeBlock: (n: unknown) => void
          }
          s.write('```plot\n')
          s.write(node.attrs.code)
          s.ensureNewLine()
          s.write('```')
          s.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll<HTMLElement>('pre > code.language-plot').forEach((code) => {
              const pre = code.parentElement
              if (!pre) return
              const div = document.createElement('div')
              div.setAttribute('data-type', 'plot-block')
              div.setAttribute('data-code', code.textContent ?? '')
              pre.replaceWith(div)
            })
          },
        },
      },
    }
  },
})
