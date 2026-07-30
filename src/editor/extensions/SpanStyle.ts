import { Mark, mergeAttributes } from '@tiptap/core'

interface SpanStyleAttrs {
  color: string | null
  backgroundColor: string | null
  fontSize: string | null
}

function buildStyle(attrs: SpanStyleAttrs): string {
  const parts: string[] = []
  if (attrs.color) parts.push(`color: ${attrs.color}`)
  if (attrs.backgroundColor) parts.push(`background-color: ${attrs.backgroundColor}`)
  if (attrs.fontSize) parts.push(`font-size: ${attrs.fontSize}`)
  return parts.join('; ')
}

function parseStyleAttr(el: HTMLElement): SpanStyleAttrs {
  return {
    color: el.style.color || null,
    backgroundColor: el.style.backgroundColor || null,
    fontSize: el.style.fontSize || null,
  }
}

export const SpanStyle = Mark.create({
  name: 'spanStyle',

  addAttributes() {
    return {
      color: { default: null },
      backgroundColor: { default: null },
      fontSize: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[style]',
        getAttrs: (el) => parseStyleAttr(el as HTMLElement),
      },
      {
        tag: 'font',
        getAttrs: (el) => {
          const e = el as HTMLElement
          const color = e.getAttribute('color') || null
          return { color, backgroundColor: null, fontSize: null }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const { color, backgroundColor, fontSize, ...rest } = HTMLAttributes as SpanStyleAttrs & Record<string, unknown>
    const style = buildStyle({ color: color ?? null, backgroundColor: backgroundColor ?? null, fontSize: fontSize ?? null })
    return ['span', mergeAttributes(rest, style ? { style } : {}), 0]
  },
})
