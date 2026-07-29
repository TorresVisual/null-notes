import { useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { api } from '../../lib/tauri'

interface PdfPageBlockAttrs {
  src: string
  width: number
  height: number
}

function PdfPageBlockView({ node }: ReactNodeViewProps) {
  const { src, width, height } = node.attrs as unknown as PdfPageBlockAttrs
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    if (!src) return
    api.pdf.readPage(src).then((base64) => {
      if (!cancelled) setDataUrl(`data:image/png;base64,${base64}`)
    })
    return () => {
      cancelled = true
    }
  }, [src])

  if (!src) return null
  return (
    <div className="pdf-page-block">
      {dataUrl ? (
        <img src={dataUrl} width={width} height={height} alt="Imported PDF page" />
      ) : (
        <p className="status">Loading page…</p>
      )}
    </div>
  )
}

export const PdfPageBlock = Node.create({
  name: 'pdfPageBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: 1700 },
      height: { default: 2200 },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="pdf-page-block"]',
        getAttrs: (el) => ({
          src: (el as HTMLElement).getAttribute('data-src'),
          width: parseInt((el as HTMLElement).getAttribute('data-width') ?? '1700', 10),
          height: parseInt((el as HTMLElement).getAttribute('data-height') ?? '2200', 10),
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'pdf-page-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PdfPageBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: PdfPageBlockAttrs }) {
          const { src, width, height } = node.attrs
          ;(state as { write: (s: string) => void }).write('```pdf-page\n')
          ;(state as { write: (s: string) => void }).write(JSON.stringify({ src, width, height }))
          ;(state as { ensureNewLine: () => void }).ensureNewLine()
          ;(state as { write: (s: string) => void }).write('```')
          ;(state as { closeBlock: (n: unknown) => void }).closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            const selector = 'pre > code.language-pdf-page'
            element.querySelectorAll<HTMLElement>(selector).forEach((code) => {
              const pre = code.parentElement
              if (!pre) return
              try {
                const data = JSON.parse(code.textContent ?? '{}') as Partial<PdfPageBlockAttrs>
                const div = document.createElement('div')
                div.setAttribute('data-type', 'pdf-page-block')
                div.setAttribute('data-src', data.src ?? '')
                div.setAttribute('data-width', String(data.width ?? 1700))
                div.setAttribute('data-height', String(data.height ?? 2200))
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
