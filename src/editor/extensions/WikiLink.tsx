import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'
import { useCreateNote } from '../../hooks/useCreateNote'
import { recordJumpFromHere } from '../../lib/navigationHistory'

interface WikiLinkAttrs {
  title: string
}

function WikiLinkView({ node }: ReactNodeViewProps) {
  const { title } = node.attrs as unknown as WikiLinkAttrs
  const notes = useNotesStore((s) => s.notes)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const createNote = useCreateNote()

  const target = notes.find((n) => n.title.toLowerCase() === title.toLowerCase())

  // Creating the missing note is what resolves the link: the new note lands in
  // the store, this view re-renders, and `target` is found on the next pass.
  function handleClick() {
    recordJumpFromHere()
    if (target) {
      openTab(target.path)
      return
    }
    void createNote(title)
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`wiki-link${target ? '' : ' wiki-link-missing'}`}
      onClick={handleClick}
      title={target ? target.path : `Create note "${title}"`}
      spellCheck={false}
    >
      {title}
    </NodeViewWrapper>
  )
}

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      title: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="wiki-link"]',
        getAttrs: (el) => ({
          title: (el as HTMLElement).getAttribute('data-title') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-type': 'wiki-link' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: WikiLinkAttrs }) {
          ;(state as { write: (s: string) => void }).write(`[[${node.attrs.title}]]`)
        },
        parse: {
          setup(markdownit: {
            core: { ruler: { push: (name: string, fn: (state: unknown) => void) => void } }
          }) {
            markdownit.core.ruler.push('wiki_link', (state: unknown) => {
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
                  const parts = child.content.split(/\[\[([^\]\n]+)\]\]/)
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
                        content: `<span data-type="wiki-link" data-title="${encodeAttr(part)}"></span>`,
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

function encodeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
