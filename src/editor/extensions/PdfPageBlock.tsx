import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { api } from '../../lib/tauri'
import { inkApi } from '../../lib/ink'
import { InkCanvas } from '../../ink/InkCanvas'

interface PdfPageBlockAttrs {
  src: string
  width: number
  height: number
}

// One ink sidecar per page, named after it (`page-0.png` -> `page-0.svg`) —
// deterministic, so no extra node attribute or markdown schema change is
// needed to remember which file a page's annotations live in.
export function inkSrcFor(inkDir: string, pageSrc: string): string {
  const sep = inkDir.includes('\\') ? '\\' : '/'
  const base = pageSrc.split(/[\\/]/).pop() ?? pageSrc
  return `${inkDir}${sep}${base.replace(/\.[^.]+$/, '.svg')}`
}

function PdfPageBlockView({ node, editor }: ReactNodeViewProps) {
  const { src, width, height } = node.attrs as unknown as PdfPageBlockAttrs
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [inkSrc, setInkSrc] = useState<string | null>(null)
  const [geometry, setGeometry] = useState({ left: 0, top: 0, zoom: 1 })
  const imgRef = useRef<HTMLImageElement>(null)

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

  useEffect(() => {
    const notePath = editor.storage.noteContext.notePath
    if (!notePath || !src) return
    let cancelled = false
    void inkApi.ensureDir(notePath).then((dir) => {
      if (!cancelled) setInkSrc(inkSrcFor(dir, src))
    })
    return () => {
      cancelled = true
    }
  }, [editor, src])

  // Ink is stored in the page's native pixel space (matches `width`/`height`
  // above) so a stroke stays put on the page regardless of column width —
  // the image itself scales responsively, so its rendered size is tracked
  // and fed to InkCanvas's own `zoom` as the ratio between the two.
  useEffect(() => {
    const img = imgRef.current
    if (!img || !dataUrl) return
    const sync = () => {
      setGeometry({ left: img.offsetLeft, top: img.offsetTop, zoom: img.offsetWidth / width })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(img)
    return () => observer.disconnect()
  }, [dataUrl, width])

  if (!src) return null
  return (
    <div className="pdf-page-block">
      {dataUrl ? (
        <>
          <img ref={imgRef} src={dataUrl} width={width} height={height} alt="Imported PDF page" />
          {inkSrc && (
            <div className="pdf-page-ink" style={{ left: geometry.left, top: geometry.top }}>
              <InkCanvas svgPath={inkSrc} width={width} height={height} zoom={geometry.zoom} />
            </div>
          )}
        </>
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
