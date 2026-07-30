import { Extension } from '@tiptap/core'

// Extends the existing Paragraph and Heading nodes that StarterKit registers
// to carry an `align` attribute. This must run as an extension (not a new node)
// so that we augment the already-registered nodes instead of replacing them.

type TextAlign = 'left' | 'center' | 'right' | 'justify'

const ALIGN_VALUES: TextAlign[] = ['left', 'center', 'right', 'justify']

function alignAttrs() {
  return {
    textAlign: {
      default: null as TextAlign | null,
      parseHTML: (element: HTMLElement) => {
        const align = element.getAttribute('align') || element.style.textAlign || null
        return ALIGN_VALUES.includes(align as TextAlign) ? (align as TextAlign) : null
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        if (!attrs['textAlign']) return {}
        return { style: `text-align: ${attrs['textAlign']}` }
      },
    },
  }
}

function alignParseRules(tags: string[]) {
  return tags.map((tag) => ({
    tag,
    getAttrs: (el: HTMLElement) => {
      const align = el.getAttribute('align') || el.style.textAlign || null
      return { textAlign: ALIGN_VALUES.includes(align as TextAlign) ? align : null }
    },
  }))
}

export const TextAlignment = Extension.create({
  name: 'textAlignment',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: alignAttrs(),
      },
    ]
  },

  // Parse <center> as a paragraph with align:center
  addExtensions() {
    return []
  },
})
