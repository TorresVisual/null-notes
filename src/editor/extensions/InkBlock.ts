import { Node, mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { InkBlockView } from './InkBlockView'
import { decodeSrc, encodeSrc } from './NoteImage'

interface InkBlockAttrs {
  src: string
  width: number
  height: number
  inline: boolean
}

// GitHub renders none of our custom fences, but it does render a repo-relative
// image — so a drawing is written as the sidecar SVG itself, with the block's
// size and inline flag in the URL fragment (`#ink=700x400[,inline]`), which
// GitHub ignores. The attribute holds the absolute path the canvas needs to read
// and write the file; only the `Note.ink/file.svg` tail goes into the .md.
function inkImageMarkdown(src: string, width: number, height: number, inline: boolean): string {
  const tail = src.replace(/\\/g, '/').split('/').slice(-2).join('/')
  const destination = encodeSrc(tail).replace(/[()]/g, '\\$&')
  return `![Drawing](${destination}#ink=${width}x${height}${inline ? ',inline' : ''})`
}

// The inverse of the tail above: sidecars sit beside the note, so the absolute
// path is the note's folder plus the relative path, in the note's own separator.
function beside(notePath: string, relative: string): string {
  const cut = Math.max(notePath.lastIndexOf('/'), notePath.lastIndexOf('\\'))
  if (cut < 0) return relative
  return notePath.slice(0, cut + 1) + relative.replace(/\//g, notePath.charAt(cut))
}

function inkBlockElement(src: string, width: number, height: number, inline: boolean): HTMLElement {
  const div = document.createElement('div')
  div.setAttribute('data-type', 'ink-block')
  div.setAttribute('data-src', src)
  div.setAttribute('data-width', String(width))
  div.setAttribute('data-height', String(height))
  div.setAttribute('data-inline', String(inline))
  return div
}

export const InkBlock = Node.create({
  name: 'inkBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: 700 },
      height: { default: 900 },
      inline: { default: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="ink-block"]',
        getAttrs: (el) => ({
          src: (el as HTMLElement).getAttribute('data-src'),
          width: parseInt((el as HTMLElement).getAttribute('data-width') ?? '700', 10),
          height: parseInt((el as HTMLElement).getAttribute('data-height') ?? '900', 10),
          inline: (el as HTMLElement).getAttribute('data-inline') === 'true',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'ink-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(InkBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: InkBlockAttrs }) {
          const { src, width, height, inline } = node.attrs
          const s = state as { write: (s: string) => void; closeBlock: (n: unknown) => void }
          s.write(inkImageMarkdown(src, width, height, inline))
          s.closeBlock(node)
        },
        parse: {
          updateDOM(this: { editor: Editor }, element: HTMLElement) {
            const notePath = this.editor.storage.noteContext.notePath
            element.querySelectorAll<HTMLImageElement>('img[src*=".ink/"][src*="#ink="]').forEach((img) => {
              const [path = '', spec = ''] = (img.getAttribute('src') ?? '').split('#ink=')
              const [size = '', flag] = spec.split(',')
              const [w, h] = size.split('x').map((n) => parseInt(n, 10))
              const block = inkBlockElement(beside(notePath, decodeSrc(path)), w || 700, h || 900, flag === 'inline')
              const paragraph = img.parentElement
              const lone = paragraph?.tagName === 'P' && paragraph.childNodes.length === 1
              ;(lone ? paragraph : img).replaceWith(block)
            })
            // Notes written before the image form (and canvas notes / solution
            // scaffolds that still emit it) open from the fence and are rewritten
            // as an image on the next save. `ink-page` is the short-lived
            // full-page fence, accepted for the same reason.
            const selector = 'pre > code.language-ink, pre > code.language-ink-page'
            element.querySelectorAll<HTMLElement>(selector).forEach((code) => {
              const pre = code.parentElement
              if (!pre) return
              try {
                const data = JSON.parse(code.textContent ?? '{}') as Partial<InkBlockAttrs>
                pre.replaceWith(inkBlockElement(data.src ?? '', data.width ?? 700, data.height ?? 900, data.inline === true))
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
