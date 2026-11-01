import { Node } from '@tiptap/core'

const COMMENT_NODE = 8

interface HtmlCommentAttrs {
  text: string
}

// ProseMirror's DOMParser skips Comment nodes, so a plain `<!-- note -->` in a
// file vanished on the first save. Same remedy as `SrState`: `updateDOM`
// rewrites each top-level comment into an invisible element a normal
// `parseHTML` rule can claim. Only block-level comments are kept; one inside a
// paragraph has no valid place to live and is still dropped.
export const HtmlComment = Node.create({
  name: 'htmlComment',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      text: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="html-comment"]',
        getAttrs: (el) => ({ text: (el as HTMLElement).getAttribute('data-text') ?? '' }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as HtmlCommentAttrs
    return ['div', { 'data-type': 'html-comment', 'data-text': attrs.text, style: 'display:none', contenteditable: 'false' }]
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; ensureNewLine: () => void; closeBlock: (n: unknown) => void },
          node: { attrs: HtmlCommentAttrs },
        ) {
          state.ensureNewLine()
          state.write(`<!--${node.attrs.text}-->`)
          state.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            for (const child of Array.from(element.childNodes)) {
              if (child.nodeType !== COMMENT_NODE) continue
              const data = (child as Comment).data
              if (/^\s*sr\s+due=/.test(data)) continue
              const div = document.createElement('div')
              div.setAttribute('data-type', 'html-comment')
              div.setAttribute('data-text', data)
              child.replaceWith(div)
            }
          },
        },
      },
    }
  },
})
