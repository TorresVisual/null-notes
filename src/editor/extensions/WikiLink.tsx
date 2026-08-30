import { useState } from 'react'
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'
import { useCreateNote } from '../../hooks/useCreateNote'
import { recordJumpFromHere } from '../../lib/navigationHistory'
import { excerptForPreview } from '../../lib/notePreview'
import { api } from '../../lib/tauri'
import { encodeAttr } from '../../lib/htmlAttr'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'

interface WikiLinkAttrs {
  title: string
}

function WikiLinkView({ node }: ReactNodeViewProps) {
  const { title } = node.attrs as unknown as WikiLinkAttrs
  const notes = useNotesStore((s) => s.notes)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const createNote = useCreateNote()
  // "Go to definition" without clicking through: a short excerpt of the
  // target note's own content, fetched lazily on hover rather than for
  // every link on mount — most links on screen are never hovered.
  const [preview, setPreview] = useState<string | null>(null)

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

  const link = (
    <NodeViewWrapper
      as="span"
      className={`wiki-link${target ? '' : ' wiki-link-missing'}`}
      onClick={handleClick}
      title={target ? undefined : `Create note "${title}"`}
      spellCheck={false}
    >
      {title}
    </NodeViewWrapper>
  )

  if (!target) {
    return link
  }

  function handleOpenChange(open: boolean) {
    // TS doesn't carry the outer `if (!target) return`'s narrowing into a
    // nested function's body (a closure could in principle run after
    // control flow no longer guarantees it), so it's re-checked here even
    // though this branch is unreachable with target undefined at runtime.
    if (!open || !target || preview !== null) return
    void api.notes.open(target.path).then((content) => setPreview(excerptForPreview(content)))
  }

  return (
    <Tooltip onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent className="wiki-link-preview">{preview || target.path}</TooltipContent>
    </Tooltip>
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

