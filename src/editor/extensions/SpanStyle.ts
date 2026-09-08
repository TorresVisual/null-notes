import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

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

  // IDEs (VS Code) and most websites wrap every span of copied text in its
  // own inline `style="color: ..."`, even for plain unstyled text — VS
  // Code's is its theme's baseline foreground color, applied uniformly.
  // Left alone that noise round-trips into literal `<span style="...">` in
  // the saved note (same failure as DivBlock's generic <div>s). Strip it
  // from pasted HTML only, so this mark still round-trips a note's own
  // intentionally-authored colored spans loaded from a .md file.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML(html) {
            const wrapper = document.createElement('div')
            // Detached element, never attached to the document; ProseMirror
            // re-parses the returned string through the schema afterward.
            // eslint-disable-next-line no-unsanitized/property
            wrapper.innerHTML = html
            wrapper.querySelectorAll('span[style]').forEach((span) => {
              span.replaceWith(...Array.from(span.childNodes))
            })
            return wrapper.innerHTML
          },
        },
      }),
    ]
  },
})
