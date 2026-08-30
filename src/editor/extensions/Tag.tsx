import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useWorkspaceStore } from '../../store/workspace'
import { encodeAttr } from '../../lib/htmlAttr'

interface TagAttrs {
  name: string
}

function TagView({ node }: ReactNodeViewProps) {
  const { name } = node.attrs as unknown as TagAttrs
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)
  const isActive = tagFilter?.toLowerCase() === name.toLowerCase()

  function handleClick() {
    setTagFilter(isActive ? null : name)
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`tag-pill${isActive ? ' active' : ''}`}
      onClick={handleClick}
      spellCheck={false}
    >
      #{name}
    </NodeViewWrapper>
  )
}

export const Tag = Node.create({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      name: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="tag"]',
        getAttrs: (el) => ({
          name: (el as HTMLElement).getAttribute('data-name') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'tag' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TagView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: TagAttrs }) {
          ;(state as { write: (s: string) => void }).write(`#${node.attrs.name}`)
        },
        parse: {
          setup(markdownit: {
            core: { ruler: { push: (name: string, fn: (state: unknown) => void) => void } }
          }) {
            markdownit.core.ruler.push('tag', (state: unknown) => {
              const st = state as {
                tokens: Array<{
                  type: string
                  children: Array<{ type: string; content: string }> | null
                }>
              }
              for (const token of st.tokens) {
                if (token.type !== 'inline' || !token.children) continue
                const newChildren: typeof token.children = []
                for (const child of token.children) {
                  if (child.type !== 'text') {
                    newChildren.push(child)
                    continue
                  }
                  const parts = child.content.split(/(?<=^|\s)#([A-Za-z][\w-]*)/)
                  if (parts.length === 1) {
                    newChildren.push(child)
                    continue
                  }
                  for (let i = 0; i < parts.length; i++) {
                    const part = parts[i] ?? ''
                    if (i % 2 === 0) {
                      if (part) newChildren.push({ type: 'text', content: part })
                    } else {
                      newChildren.push({
                        type: 'html_inline',
                        content: `<span data-type="tag" data-name="${encodeAttr(part)}"></span>`,
                      })
                    }
                  }
                }
                token.children = newChildren
              }
            })
          },
        },
      },
    }
  },
})

