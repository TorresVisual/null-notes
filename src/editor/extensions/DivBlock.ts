import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { encodeAttr } from '../../lib/htmlAttr'

interface DivBlockAttrs {
  align: string | null
  style: string | null
  className: string | null
}

function buildDivTag(attrs: DivBlockAttrs): string {
  const parts: string[] = ['<div']
  if (attrs.align) parts.push(` align="${encodeAttr(attrs.align)}"`)
  if (attrs.className) parts.push(` class="${encodeAttr(attrs.className)}"`)
  if (attrs.style) parts.push(` style="${encodeAttr(attrs.style)}"`)
  parts.push('>')
  return parts.join('')
}

export const DivBlock = Node.create({
  name: 'divBlock',
  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      align: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('align') || null,
        renderHTML: (attrs) => (attrs['align'] ? { align: attrs['align'] as string } : {}),
      },
      style: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('style') || null,
        renderHTML: (attrs) => (attrs['style'] ? { style: attrs['style'] as string } : {}),
      },
      className: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('class') || null,
        renderHTML: (attrs) => (attrs['className'] ? { class: attrs['className'] as string } : {}),
      },
    }
  },

  parseHTML() {
    return [
      {
        // Generic <div> only — skip ones already claimed by Callout or Details
        tag: 'div:not([data-type])',
        getAttrs: (el) => ({
          align: (el as HTMLElement).getAttribute('align') || null,
          style: (el as HTMLElement).getAttribute('style') || null,
          className: (el as HTMLElement).getAttribute('class') || null,
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0]
  },

  // Real websites wrap nearly all content in layout <div>s that carry no
  // meaning for a note — left alone, every one of them round-trips into
  // literal <div> markup in the saved markdown. Unwrap generic divs out of
  // pasted HTML before the schema ever parses it; this only touches paste
  // (not a loaded .md file's own intentional `<div align="center">` etc.),
  // and skips `[data-type]` divs so internal copy-paste of Callout/Details
  // content is untouched.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML(html) {
            const wrapper = document.createElement('div')
            wrapper.innerHTML = html
            wrapper.querySelectorAll('div:not([data-type])').forEach((div) => {
              div.replaceWith(...Array.from(div.childNodes))
            })
            return wrapper.innerHTML
          },
        },
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: Record<string, unknown>,
          node: { attrs: DivBlockAttrs; content: unknown },
        ) {
          const s = state as {
            write: (text: string) => void
            ensureNewLine: () => void
            renderContent: (node: unknown) => void
            wrapBlock: (delim: string, firstDelim: string | null, node: unknown, fn: () => void) => void
          }
          s.ensureNewLine()
          s.write(buildDivTag(node.attrs))
          s.ensureNewLine()
          s.renderContent(node)
          s.ensureNewLine()
          s.write('</div>')
          s.ensureNewLine()
        },
      },
    }
  },
})
